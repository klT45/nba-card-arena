"""Source licensed player photos from Wikimedia Commons and rank them by cutout quality.

For every player we pull candidate JPEGs, run rembg's human-segmentation model, and
score the matte on objective signals: single connected figure, full-body aspect
ratio, mask density (fragmented or over-merged mattes score badly), haze and
framing margins. The best candidate per player is written to
``cards/_work/cut/<slug>.png`` and the ranking is printed for review.

    python scripts/source_players.py                       # all listed players
    python scripts/source_players.py --only durant,jokic   # substring match
"""
from __future__ import annotations

import argparse
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "cards" / "_work" / "raw"
CUT = ROOT / "cards" / "_work" / "cut"
API = "https://commons.wikimedia.org/w/api.php"
UA = {"User-Agent": "nba-card-arena/0.1 (personal non-commercial fan demo)"}

PLAYERS = [
    ("kevin-durant", "Kevin Durant"),
    ("luka-doncic", "Luka Doncic"),
    ("nikola-jokic", "Nikola Jokic"),
    ("shai-gilgeous-alexander", "Shai Gilgeous-Alexander"),
    ("anthony-edwards", "Anthony Edwards"),
    ("joel-embiid", "Joel Embiid"),
    ("anthony-davis", "Anthony Davis"),
    ("tyrese-haliburton", "Tyrese Haliburton"),
]
# Skip files whose title contains another person's name (merged two-player shots).
EXCLUDE = {
    "anthony-edwards": ["Caldwell-Pope"],
}
MAX_CANDIDATES = 6
THUMB_WIDTH = 1280
CUT_MAX_DIM = 1500


def api(params: dict, tries: int = 4) -> dict:
    url = API + "?" + urllib.parse.urlencode(params)
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                return json.load(r)
        except Exception as exc:  # noqa: BLE001
            if attempt == tries - 1:
                print("  ! api failed:", exc)
                return {}
            time.sleep(4 * (attempt + 1))
    return {}


def find_category(name: str) -> str | None:
    """Best Commons category for this player, e.g. 'Category:Anthony Edwards (basketball)'."""
    data = api({"action": "query", "format": "json", "list": "search",
                "srsearch": f"{name} basketball", "srnamespace": "14", "srlimit": "8"})
    hits = [h["title"] for h in (data.get("query") or {}).get("search", [])]
    surname = name.split()[-1].lower()
    return next((h for h in hits if surname in h.lower()), hits[0] if hits else None)


def category_files(cat: str) -> list[str]:
    data = api({"action": "query", "format": "json", "list": "categorymembers",
                "cmtitle": cat, "cmtype": "file", "cmlimit": "100"})
    return [m["title"] for m in (data.get("query") or {}).get("categorymembers", [])]


def imageinfo(titles: list[str]) -> list[tuple[str, dict]]:
    out = []
    for i in range(0, len(titles), 40):
        data = api({"action": "query", "format": "json", "titles": "|".join(titles[i:i + 40]),
                    "prop": "imageinfo", "iiprop": "url|size|mime|extmetadata",
                    "iiextmetadatafilter": "Categories", "iiurlwidth": str(THUMB_WIDTH)})
        for page in ((data.get("query") or {}).get("pages", {}) or {}).values():
            out.append((page.get("title", ""), (page.get("imageinfo") or [{}])[0]))
    return out


def names_other_player(title: str, name: str) -> bool:
    """True when the filename leads with a different person's name.

    Category membership alone is not enough: a 'Max Strus' photo can sit in the
    Anthony Davis category. Game-description titles (dates/competitions) are fine.
    """
    core = re.split(r"[(,]", re.sub(r"^File:", "", title))[0]
    ours = {w.lower() for w in name.replace("-", " ").split()}
    lead = []
    for word in core.split():
        if re.match(r"^[A-Z][A-Za-z'\-]+$", word):
            lead.append(word)
        elif lead:
            break
    return len(lead) >= 2 and not any(w.lower() in ours for w in lead)


def candidates(slug: str, name: str) -> list[dict]:
    """Files from the player's Commons category, so we never pick a namesake.

    A 19th-century lithograph by 'Anthony, Edwards & Co.' beat the real
    Anthony Edwards on raw resolution, hence the basketball-category gate.
    """
    titles = category_files(find_category(name) or "")
    rows, seen = [], set()
    banned = EXCLUDE.get(slug, [])

    def consider(title, info):
        w, h = info.get("width", 0), info.get("height", 0)
        cats = str((info.get("extmetadata") or {}).get("Categories", {}).get("value", ""))
        if info.get("mime") != "image/jpeg" or w < 1400 or "basketball" not in cats.lower():
            return
        if names_other_player(title, name):
            return
        if " and " in title.split("(")[0] or title in seen:
            return
        if any(b.lower() in title.lower() for b in banned):
            return
        seen.add(title)
        rows.append({"title": title, "w": w, "h": h, "ar": h / w,
                     "thumb": info.get("thumburl") or info.get("url")})

    for title, info in imageinfo(titles):
        consider(title, info)

    if len(rows) < 3:  # category missing/thin - fall back to search + category gate
        data = api({"action": "query", "format": "json", "generator": "search", "gsrnamespace": "6",
                    "gsrsearch": f"{name} basketball", "gsrlimit": "40", "prop": "imageinfo",
                    "iiprop": "url|size|mime|extmetadata", "iiextmetadatafilter": "Categories",
                    "iiurlwidth": str(THUMB_WIDTH)})
        for page in ((data.get("query") or {}).get("pages", {}) or {}).values():
            consider(page.get("title", ""), (page.get("imageinfo") or [{}])[0])
        time.sleep(1.5)

    rows.sort(key=lambda r: (r["ar"] < 1.15, -r["w"] * r["h"]))
    return rows


def download(url: str, dest: Path, tries: int = 5) -> bool:
    meta = dest.with_suffix(dest.suffix + ".url")
    if dest.exists() and dest.stat().st_size > 20000 and meta.exists() and meta.read_text(encoding="utf-8") == url:
        return True  # cache still matches this candidate
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
                dest.write_bytes(r.read())
            meta.write_text(url, encoding="utf-8")
            time.sleep(12)  # Wikimedia throttles bursts
            return True
        except Exception as exc:  # noqa: BLE001
            wait = 30 * (attempt + 1)
            print(f"  ! download retry in {wait}s: {exc}")
            time.sleep(wait)
    return False


def metrics(cut: Image.Image) -> dict | None:
    alpha = np.asarray(cut)[..., 3]
    mask = alpha > 64
    if mask.sum() < 800:
        return None
    labels, count = ndimage.label(mask)
    sizes = np.sort(ndimage.sum(mask, labels, range(1, count + 1)))[::-1]
    keep = labels == (int(np.argmax(ndimage.sum(mask, labels, range(1, count + 1)))) + 1)
    ys, xs = np.where(keep)
    H, W = alpha.shape
    h, w = int(np.ptp(ys) + 1), int(np.ptp(xs) + 1)
    second = float(sizes[1] / sizes[0]) if len(sizes) > 1 else 0.0
    return {
        "comps": int(count),
        "big": int((sizes >= sizes[0] * 0.05).sum()),
        "second_frac": round(second, 3),
        "ar": round(float(h / w), 2),
        "fill": round(float(keep.sum() / (h * w)), 3),
        "semi": round(float(((alpha > 20) & (alpha < 235)).mean() * 100), 1),
        "hfrac": round(float(h / H), 2),
        "touch_top": bool(ys.min() <= 2),
        "touch_bottom": bool(ys.max() >= H - 3),
        "touch_left": bool(xs.min() <= 2),
        "touch_right": bool(xs.max() >= W - 3),
    }


def rank(s: dict | None) -> float:
    """Reward one clean, dense, upright full-body figure; punish fragments/merges."""
    if not s:
        return -99
    p = 0.0
    p += 4.0 if s["big"] == 1 else (-4.0 if s["big"] >= 3 else -1.0)
    p += 2.0 if s.get("second_frac", 0) < 0.08 else (0.0 if s.get("second_frac", 0) < 0.25 else -3.0)
    p += 3.0 if 1.8 <= s["ar"] <= 3.2 else (1.0 if 1.5 <= s["ar"] < 3.8 else -3.0)
    p += 2.0 if 0.25 <= s["fill"] <= 0.68 else -2.0
    p += 2.0 if s["semi"] < 4 else (0.0 if s["semi"] < 8 else -2.0)
    p += 1.0 if not s["touch_top"] else -1.0
    p += 1.0 if not s["touch_bottom"] else 0.0
    p += 0.5 if not (s["touch_left"] or s["touch_right"]) else -0.5
    p += 1.0 if 0.55 <= s["hfrac"] <= 0.98 else 0.0
    return p


def ascii_alpha(path: Path, cols: int = 46) -> str:
    alpha = np.asarray(Image.open(path).convert("RGBA"))[..., 3]
    h, w = alpha.shape
    rows = max(1, int(cols * (h / w) * 0.5))
    small = np.asarray(Image.fromarray(alpha).resize((cols, rows), Image.BOX))
    chars = " .:-=+*#%@"
    return "\n".join("".join(chars[min(9, int(v / 25.6))] for v in row) for row in small)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated slug substrings")
    args = ap.parse_args()
    only = [s.strip() for s in args.only.split(",")] if args.only else None
    targets = [p for p in PLAYERS if not only or any(o in p[0] for o in only)]
    if not targets:
        raise SystemExit(f"no players matched --only {args.only}")

    from rembg import new_session, remove
    session = new_session("u2net_human_seg")
    CUT.mkdir(parents=True, exist_ok=True)
    ranking = {}
    for slug, name in targets:
        print(f"\n===== {name} =====")
        (RAW / slug).mkdir(parents=True, exist_ok=True)
        scored = []
        for idx, row in enumerate(candidates(slug, name)[:MAX_CANDIDATES]):
            dest = RAW / slug / f"{idx}.jpg"
            if not download(row["thumb"], dest):
                continue
            cut = remove(Image.open(dest).convert("RGBA"), session=session)
            if max(cut.size) > CUT_MAX_DIM:
                cut.thumbnail((CUT_MAX_DIM, CUT_MAX_DIM), Image.LANCZOS)
            m = metrics(cut)
            if not m:
                continue
            m.update(idx=idx, title=row["title"], rank=round(rank(m), 2))
            m["_cut"] = cut
            scored.append(m)
            print(f"  [{idx}] rank={m['rank']:6.2f} big={m['big']} 2nd={m['second_frac']:.2f} comps={m['comps']:2d} "
                  f"ar={m['ar']:.2f} fill={m['fill']:.2f} semi={m['semi']:.1f} t/b={int(m['touch_top'])}{int(m['touch_bottom'])}  {row['title'][5:]}")
        scored.sort(key=lambda x: -x["rank"])
        if not scored:
            print("  !! no candidates scored")
            continue
        best = scored[0]
        best["_cut"].save(CUT / f"{slug}.png", optimize=True)
        for s in scored:
            s.pop("_cut", None)
        ranking[slug] = {"name": name, "best": best, "all": scored}
        print(f"  -> BEST [{best['idx']}] rank={best['rank']} {best['title']}")
        print(ascii_alpha(CUT / f"{slug}.png"))
    (ROOT / "cards" / "_work").mkdir(parents=True, exist_ok=True)
    rankfile = ROOT / "cards" / "_work" / "ranking.json"
    merged = {}
    if rankfile.exists():
        try:
            merged = json.loads(rankfile.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            merged = {}
    merged.update(ranking)
    rankfile.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\nWrote cards/_work/cut/*.png")


if __name__ == "__main__":
    main()
