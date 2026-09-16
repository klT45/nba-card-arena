"""Source licensed player photos from Wikimedia Commons and rank them by cutout quality.

For every player we pull candidate JPEGs, run rembg's segmentation model, and
score the matte on objective signals. The score targets *poster* framing, not
just a clean matte: one figure, filling a good share of the frame, cut around
three-quarter body height, with no bystanders merged in. Distant full-body
shots with crowds score badly even when their matte is technically clean.

The best candidate per player is written to ``cards/_work/cut/<slug>.png`` and
the ranking is printed for review.

    python scripts/source_players.py                       # all listed players
    python scripts/source_players.py --only durant,jokic   # substring match
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import time
import unicodedata
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
MODEL = "birefnet-general-lite"

PLAYERS = [
    ("lebron-james", "LeBron James"),
    ("stephen-curry", "Stephen Curry"),
    ("luka-doncic", "Luka Doncic"),
    ("shai-gilgeous-alexander", "Shai Gilgeous-Alexander"),
    ("tyrese-haliburton", "Tyrese Haliburton"),
    ("devin-booker", "Devin Booker"),
    ("anthony-edwards", "Anthony Edwards"),
    ("kevin-durant", "Kevin Durant"),
    ("jayson-tatum", "Jayson Tatum"),
    ("giannis-antetokounmpo", "Giannis Antetokounmpo"),
    ("victor-wembanyama", "Victor Wembanyama"),
    ("anthony-davis", "Anthony Davis"),
    ("joel-embiid", "Joel Embiid"),
    ("nikola-jokic", "Nikola Jokic"),
    # COMMON tier - solid starters rather than MVP candidates. Chosen partly on
    # Commons coverage: players with FIBA/Olympics photos have far more usable
    # game shots than US-only ones. Verified with scripts/probe_commons.py.
    ("darius-garland", "Darius Garland"),
    ("trae-young", "Trae Young"),
    ("cade-cunningham", "Cade Cunningham"),
    ("josh-giddey", "Josh Giddey"),
    ("franz-wagner", "Franz Wagner"),
    ("evan-mobley", "Evan Mobley"),
    ("alperen-sengun", "Alperen Sengun"),
    ("rudy-gobert", "Rudy Gobert"),
]
# Pin the Commons category when search cannot guess it. Commons carries two
# Devin Bookers: born 1991 (Euroleague) with 85 files and born 1996 (Phoenix
# Suns) with 38. "Pick the most populated category" therefore lands on the
# wrong man, so this one has to be pinned explicitly.
CATEGORY = {
    "devin-booker": "Category:Devin Booker (basketball, born 1996)",
    # The "in 2012" sub-category is by far the most populated on Commons, but it
    # only carries Miami-era photos. The roster is Lakers, so pin a Lakers year
    # sub-category with enough files to actually have game shots.
    "lebron-james": "Category:LeBron James in 2020",
}
# Skip files whose title contains another person's name (merged two-player shots).
EXCLUDE = {
    "anthony-edwards": ["Caldwell-Pope"],
    "nikola-jokic": ["Gobert"],
    "jayson-tatum": ["Banchero"],
    # Common-name confusion that the per-word title check misses: Bronny is
    # LeBron's son and a real Commons subject. The lead-word detector bails on
    # the quote in `"Bronny"`, so it stops after "Lebron" and treats the title
    # as a normal LeBron James file.
    "lebron-james": ["Bronny"],
    # Same-surname relatives. `names_other_player` only flags a title when
    # *none* of its lead words appear in our name, so a sibling sharing the
    # surname slips straight through: "Moritz Wagner" matches "wagner".
    "franz-wagner": ["Moritz"],
    "evan-mobley": ["Isaiah"],
}
MAX_CANDIDATES = 10
THUMB_WIDTH = 1400
# The user wants hot, in-game shots, not studio uploads. Demote (do not drop)
# practice / portrait uploads so real game photos are tried first.
DEMOTE = ("practice", "portrait", "media day", "training", "warm-up", "warmup",
          "headshot", "press conference", "jersey presentation")
# BiRefNet is memory hungry on CPU; cap the inference input so onnxruntime does
# not die with "bad allocation" on tall photos.
INFER_MAX_DIM = 1200
CUT_MAX_DIM = 1800


_MIN_GAP = 1.2          # seconds between Commons API calls
_last_call = [0.0]


def api(params: dict, tries: int = 4) -> dict:
    """Throttled Commons query.

    Commons answers 429 quickly once a script fires a burst of queries, and a
    throttled `categoryinfo` call silently degrades player disambiguation
    (it falls back to hit order and picks the wrong namesake). So: pace every
    call, and back off hard on 429.
    """
    url = API + "?" + urllib.parse.urlencode(params)
    for attempt in range(tries):
        gap = _MIN_GAP - (time.monotonic() - _last_call[0])
        if gap > 0:
            time.sleep(gap)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                out = json.load(r)
                _last_call[0] = time.monotonic()
                return out
        except urllib.error.HTTPError as exc:
            _last_call[0] = time.monotonic()
            if exc.code != 429:
                if attempt == tries - 1:
                    print("  ! api failed:", exc)
                    return {}
                time.sleep(4 * (attempt + 1))
                continue
            wait = int(exc.headers.get("Retry-After") or 0) or 20 * (attempt + 1)
            print(f"  ! 429 throttled, waiting {wait}s")
            time.sleep(wait)
        except Exception as exc:  # noqa: BLE001
            _last_call[0] = time.monotonic()
            if attempt == tries - 1:
                print("  ! api failed:", exc)
                return {}
            time.sleep(4 * (attempt + 1))
    return {}


def _fold(s: str) -> str:
    """Lower-case and strip diacritics, so 'Nikola Jokić' matches 'jokic'."""
    return "".join(c for c in unicodedata.normalize("NFKD", s)
                   if not unicodedata.combining(c)).lower()


def find_category(name: str) -> str | None:
    """Best Commons category for this player, e.g. 'Category:Anthony Edwards (basketball)'.

    Namesakes are a real hazard here. Commons carries both
    'Devin Booker (basketball, born 1991)' — the Euroleague guard — and
    'Devin Booker (basketball, born 1996)' — the Phoenix Suns star. Matching on
    the surname alone picked the Euroleague player and put the wrong man on the
    card. The famous player's category is by far the most populated one, so
    disambiguate on category file counts rather than on hit order.
    """
    data = api({"action": "query", "format": "json", "list": "search",
                "srsearch": f"{name} basketball", "srnamespace": "14", "srlimit": "8"})
    hits = [h["title"] for h in (data.get("query") or {}).get("search", [])]
    if not hits:
        return None
    words = [_fold(w) for w in name.replace("-", " ").split()]
    cand = [h for h in hits if words[-1] in _fold(h)]
    strong = [h for h in cand if all(w in _fold(h) for w in words)]
    pool = (strong or cand or hits)[:10]
    info = api({"action": "query", "format": "json", "titles": "|".join(pool),
                "prop": "categoryinfo"})
    counts = {p.get("title"): (p.get("categoryinfo") or {}).get("files", 0)
              for p in ((info.get("query") or {}).get("pages", {}) or {}).values()}
    best = max(pool, key=lambda t: counts.get(t, 0))
    return best if counts.get(best, 0) >= 8 else pool[0]


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
    titles = category_files(CATEGORY.get(slug) or find_category(name) or "")
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
                     "demote": any(k in title.lower() for k in DEMOTE),
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

    rows.sort(key=lambda r: (r["ar"] < 1.15, r["demote"], -r["w"] * r["h"]))
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
            time.sleep(3)  # be polite to Wikimedia, but do not crawl
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

    # Silhouette width near the head, as a share of figure height. One head is
    # roughly 0.10-0.18. When two or three people stand shoulder to shoulder the
    # model fuses them into a *single* connected component, so component counts
    # and `second_frac` both look clean — but the blob is already wide at the
    # very top. That is the tell.
    span = np.zeros(h)
    for r in range(h):
        idx = np.flatnonzero(keep[ys.min() + r, xs.min():xs.max() + 1])
        if idx.size:
            span[r] = idx[-1] - idx[0] + 1
    top25 = float(span[:max(1, int(h * 0.25))].mean() / h)

    return {
        "comps": int(count),
        "big": int((sizes >= sizes[0] * 0.05).sum()),
        "second_frac": round(second, 3),
        "top25": round(top25, 3),
        "ar": round(float(h / w), 2),
        "fill": round(float(keep.sum() / (h * w)), 3),
        "semi": round(float(((alpha > 20) & (alpha < 235)).mean() * 100), 1),
        "hfrac": round(float(h / H), 2),
        "wfrac": round(float(w / W), 2),
        "touch_top": bool(ys.min() <= 2),
        "touch_bottom": bool(ys.max() >= H - 3),
        "touch_left": bool(xs.min() <= 2),
        "touch_right": bool(xs.max() >= W - 3),
    }


def rank(s: dict | None) -> float:
    """Reward one large, clean, three-quarter figure; punish crowds and distance.

    A card is a poster: the subject has to dominate the frame. Two things used
    to go wrong - the model merged spectators into the matte, and the winner was
    a distant full-body shot where the player is a small figure in a wide scene.
    Both are now heavily penalised.
    """
    if not s:
        return -99
    p = 0.0
    # Exactly one person, and nobody else of comparable size.
    p += 5.0 if s["big"] == 1 else (-7.0 if s["big"] >= 3 else -2.0)
    p += 3.5 if s["second_frac"] < 0.04 else (0.0 if s["second_frac"] < 0.14 else -5.0)
    # People fused into one blob (shoulder to shoulder) still read as a single
    # component. Catch them on silhouette width at head level instead.
    p += 3.0 if s["top25"] < 0.22 else (-6.0 if s["top25"] > 0.28 else 0.0)
    # Framing: how much of the photo the subject actually occupies.
    p += 4.5 * float(np.clip((s["hfrac"] - 0.48) / 0.40, 0, 1))
    p += 3.0 * float(np.clip((s.get("wfrac", 0) - 0.22) / 0.33, 0, 1))
    # Three-quarter / half body beats a distant head-to-toe figure.
    p += 4.0 if 1.10 <= s["ar"] <= 2.10 else (1.0 if 1.00 <= s["ar"] < 2.60 else -5.0)
    p += 2.0 if 0.30 <= s["fill"] <= 0.78 else -2.0
    p += 2.0 if s["semi"] < 4 else (0.0 if s["semi"] < 8 else -2.0)
    p += 2.0 if not s["touch_top"] else -3.0
    p += 1.0 if not s["touch_bottom"] else 0.0
    p += 1.0 if not (s["touch_left"] or s["touch_right"]) else -1.0
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
    ap.add_argument("--publish", action="store_true",
                    help="also copy the winning cutout + photo into cards/library/<id>/")
    args = ap.parse_args()
    only = [s.strip() for s in args.only.split(",")] if args.only else None
    publish = args.publish
    targets = [p for p in PLAYERS if not only or any(o in p[0] for o in only)]
    if not targets:
        raise SystemExit(f"no players matched --only {args.only}")

    from rembg import new_session, remove
    session = new_session(MODEL)
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
            try:
                src = Image.open(dest).convert("RGBA")
                if max(src.size) > INFER_MAX_DIM:
                    src.thumbnail((INFER_MAX_DIM, INFER_MAX_DIM), Image.LANCZOS)
                cut = remove(src, session=session)
            except Exception as exc:  # noqa: BLE001 - one bad candidate must not stop the run
                print(f"  [{idx}] skipped: {type(exc).__name__} {str(exc)[:90]}")
                continue
            if max(cut.size) > CUT_MAX_DIM:
                cut.thumbnail((CUT_MAX_DIM, CUT_MAX_DIM), Image.LANCZOS)
            m = metrics(cut)
            if not m:
                continue
            m.update(idx=idx, title=row["title"], rank=round(rank(m), 2))
            m["_cut"] = cut
            scored.append(m)
            print(f"  [{idx}] rank={m['rank']:6.2f} big={m['big']} 2nd={m['second_frac']:.2f} comps={m['comps']:2d} "
                  f"ar={m['ar']:.2f} h/w={m['hfrac']:.2f}/{m.get('wfrac', 0):.2f} fill={m['fill']:.2f} "
                  f"top25={m['top25']:.3f} semi={m['semi']:.1f} t/b={int(m['touch_top'])}{int(m['touch_bottom'])}  {row['title'][5:]}")
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
        if publish:
            lib = ROOT / "cards" / "library" / slug
            lib.mkdir(parents=True, exist_ok=True)
            shutil.copy2(CUT / f"{slug}.png", lib / "cutout.png")
            raw = RAW / slug / f"{best['idx']}.jpg"
            if raw.exists():
                shutil.copy2(raw, lib / "photo.jpg")
            print(f"  -> published to cards/library/{slug}/")
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
