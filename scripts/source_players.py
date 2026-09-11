"""Source licensed player photos from Wikimedia Commons and rank them by cutout quality.

For every player we pull candidate JPEGs, run rembg's human-segmentation model, and
score the resulting matte on objective signals (single connected figure, full-body
aspect ratio, framing margins). The best candidate per player is written to
``cards/_work/cut/<slug>.png`` and the ranking is printed so it can be reviewed.

The chosen subjects are then consumed by ``build_static_cards.py``. Keep this file
as provenance for where each photo came from.
"""
from __future__ import annotations

import json
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
UA = {"User-Agent": "nba-card-arena/0.1 (personal non-commercial fan demo; python-urllib)"}

PLAYERS = [
    ("stephen-curry", "Stephen Curry"),
    ("devin-booker", "Devin Booker"),
    ("kevin-durant", "Kevin Durant"),
    ("giannis-antetokounmpo", "Giannis Antetokounmpo"),
    ("nikola-jokic", "Nikola Jokic"),
    ("luka-doncic", "Luka Doncic"),
    ("jayson-tatum", "Jayson Tatum"),
    ("victor-wembanyama", "Victor Wembanyama"),
]
MAX_CANDIDATES = 3
THUMB_WIDTH = 1024
CUT_MAX_DIM = 1500


def api(params: dict, tries: int = 4) -> dict:
    url = API + "?" + urllib.parse.urlencode(params)
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.load(r)
        except Exception as exc:  # noqa: BLE001 - rate limits are expected
            if attempt == tries - 1:
                print("  ! api failed:", exc)
                return {}
            time.sleep(4 * (attempt + 1))
    return {}


def candidates(name: str) -> list[dict]:
    """Return candidate files, portrait framing first (better for a card subject)."""
    data = api({
        "action": "query", "format": "json", "generator": "search", "gsrnamespace": "6",
        "gsrsearch": f"{name} basketball", "gsrlimit": "40", "prop": "imageinfo",
        "iiprop": "url|size|mime", "iiurlwidth": str(THUMB_WIDTH),
    })
    rows, seen = [], set()
    for page in ((data.get("query") or {}).get("pages", {}) or {}).values():
        info = (page.get("imageinfo") or [{}])[0]
        w, h = info.get("width", 0), info.get("height", 0)
        title = page.get("title", "")
        if info.get("mime") != "image/jpeg" or w < 1400 or "Antetokounmpo" in title and name != "Giannis Antetokounmpo":
            continue
        if " and " in title.split("(")[0]:  # group shots are poor single-subject sources
            continue
        if title in seen:
            continue
        seen.add(title)
        rows.append({"title": title, "w": w, "h": h, "ar": h / w,
                     "thumb": info.get("thumburl") or info.get("url")})
    time.sleep(1.5)
    rows.sort(key=lambda r: (r["ar"] < 1.15, -r["w"] * r["h"]))
    return rows


def download(url: str, dest: Path, tries: int = 5) -> bool:
    if dest.exists() and dest.stat().st_size > 20000:
        return True  # cached from an earlier run
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=120) as r:
                dest.write_bytes(r.read())
            time.sleep(12)  # Wikimedia throttles bursts aggressively
            return True
        except Exception as exc:  # noqa: BLE001
            wait = 30 * (attempt + 1)
            print(f"  ! download retry in {wait}s: {exc}")
            time.sleep(wait)
    return False


def score(alpha: np.ndarray) -> dict | None:
    mask = alpha > 64
    if mask.sum() < 500:
        return None
    labels, count = ndimage.label(mask)
    sizes = ndimage.sum(mask, labels, range(1, count + 1))
    main = int(np.argmax(sizes)) + 1
    keep = labels == main
    ys, xs = np.where(keep)
    h, w = int(np.ptp(ys) + 1), int(np.ptp(xs) + 1)
    height, width = alpha.shape
    single = sizes.max() / mask.sum()
    ar = h / w
    return {
        "single": round(float(single), 3),
        "comps": int(count),
        "ar": round(float(ar), 2),
        "coverage": round(float(mask.mean()), 3),
        "height_frac": round(float(h / height), 2),
        "touch_top": bool(ys.min() <= 2),
        "touch_bottom": bool(ys.max() >= height - 3),
        "touch_left": bool(xs.min() <= 2),
        "touch_right": bool(xs.max() >= width - 3),
    }


def rank(s: dict) -> float:
    """Higher is better; rewards one clean, full-body, fully-framed figure."""
    if not s:
        return -1
    pts = 0.0
    pts += 3.0 * (s["single"] >= 0.92) + 1.5 * (0.8 <= s["single"] < 0.92)
    pts += 2.0 if 1.9 <= s["ar"] <= 4.2 else (0.8 if 1.5 <= s["ar"] < 4.8 else 0)
    pts += 1.0 if not s["touch_top"] else 0
    pts += 1.0 if not s["touch_bottom"] else 0
    pts += 0.5 if not (s["touch_left"] or s["touch_right"]) else 0
    pts += 1.0 if 0.55 <= s["height_frac"] <= 0.97 else 0
    pts -= 1.0 * (s["comps"] > 6)
    return pts


def ascii_alpha(path: Path, cols: int = 46) -> str:
    alpha = np.asarray(Image.open(path).convert("RGBA"))[..., 3]
    h, w = alpha.shape
    rows = max(1, int(cols * (h / w) * 0.5))
    small = np.asarray(Image.fromarray(alpha).resize((cols, rows), Image.BOX))
    chars = " .:-=+*#%@"
    return "\n".join("".join(chars[min(9, int(v / 25.6))] for v in row) for row in small)


def main() -> None:
    from rembg import new_session, remove

    session = new_session("u2net_human_seg")
    CUT.mkdir(parents=True, exist_ok=True)
    ranking = {}
    for slug, name in PLAYERS:
        print(f"\n===== {name} =====")
        (RAW / slug).mkdir(parents=True, exist_ok=True)
        rows = candidates(name)[:MAX_CANDIDATES]
        scored = []
        for idx, row in enumerate(rows):
            dest = RAW / slug / f"{idx}.jpg"
            if not download(row["thumb"], dest):
                continue
            cut = remove(Image.open(dest).convert("RGBA"), session=session)
            if max(cut.size) > CUT_MAX_DIM:
                cut.thumbnail((CUT_MAX_DIM, CUT_MAX_DIM), Image.LANCZOS)
            alpha = np.asarray(cut)[..., 3]
            s = score(alpha)
            if not s:
                continue
            s.update(idx=idx, title=row["title"], w=row["w"], h=row["h"])
            s["rank"] = round(rank(s), 2)
            out = CUT / f"{slug}__{idx}.png"
            cut.save(out, optimize=True)
            scored.append(s)
            print(f"  [{idx}] rank={s['rank']:5.2f} single={s['single']:.2f} comps={s['comps']:2d} "
                  f"ar={s['ar']:.2f} cov={s['coverage']:.2f} hfrac={s['height_frac']:.2f} "
                  f"top={int(s['touch_top'])} bot={int(s['touch_bottom'])}  {row['title'][5:]}")
        scored.sort(key=lambda x: -x["rank"])
        if not scored:
            print("  !! no candidates scored")
            continue
        best = scored[0]
        Image.open(CUT / f"{slug}__{best['idx']}.png").save(CUT / f"{slug}.png", optimize=True)
        ranking[slug] = {"name": name, "best": best, "all": scored}
        print(f"  -> BEST [{best['idx']}]: {best['title']}")
        print(ascii_alpha(CUT / f"{slug}.png"))
    (ROOT / "cards" / "_work" / "ranking.json").write_text(
        json.dumps(ranking, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\nWrote cards/_work/cut/*.png and ranking.json")


if __name__ == "__main__":
    main()
