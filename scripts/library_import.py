"""Import sourced assets into the player library and record their attribution.

    python scripts/library_import.py                 # every slug in ranking.json
    python scripts/library_import.py shai-gilgeous-alexander

For each slug it copies the best candidate from ``cards/_work`` into
``cards/library/<slug>/`` and upserts the player in ``players.json``, fetching
the author and license from Wikimedia Commons so credit stays accurate.
New players' metadata lives in NEW_PLAYERS below.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LIBRARY = ROOT / "cards" / "library"
WORK = ROOT / "cards" / "_work"
API = "https://commons.wikimedia.org/w/api.php"
UA = {"User-Agent": "nba-card-arena/0.1 (personal non-commercial fan demo)"}

NEW_PLAYERS = {
    "shai-gilgeous-alexander": {
        "name": "Shai Gilgeous-Alexander", "number": "2", "team": "Oklahoma City", "teamShort": "OKC",
        "positions": ["PG", "SG"], "positionsZh": ["控卫", "分卫"], "rarity": "MYTHIC",
        "title": "THE SMOOTH", "accent": "#007ac1", "accent2": "#002d62", "style": "prism",
    },
    "anthony-edwards": {
        "name": "Anthony Edwards", "number": "5", "team": "Minnesota", "teamShort": "MIN",
        "positions": ["SG", "SF"], "positionsZh": ["分卫", "小前锋"], "rarity": "MYTHIC",
        "title": "ANT-MAN", "accent": "#78be20", "accent2": "#0c2340", "style": "arena",
    },
    "joel-embiid": {
        "name": "Joel Embiid", "number": "21", "team": "Philadelphia", "teamShort": "PHI",
        "positions": ["C"], "positionsZh": ["中锋"], "rarity": "MYTHIC",
        "title": "THE PROCESS", "accent": "#ed174c", "accent2": "#006bb6", "style": "gold",
    },
    "anthony-davis": {
        "name": "Anthony Davis", "number": "3", "team": "Dallas", "teamShort": "DAL",
        "positions": ["PF", "C"], "positionsZh": ["大前锋", "中锋"], "rarity": "MYTHIC",
        "title": "THE BROW", "accent": "#2274c4", "accent2": "#002b5e", "style": "arena",
    },
    "tyrese-haliburton": {
        "name": "Tyrese Haliburton", "number": "0", "team": "Indiana", "teamShort": "IND",
        "positions": ["PG", "SG"], "positionsZh": ["控卫", "分卫"], "rarity": "ELITE",
        "title": "THE ENGINE", "accent": "#fdbb30", "accent2": "#002d62", "style": "prism",
    },
}

def strip_html(value: str) -> str:
    return re.sub(r"<[^>]+>", "", value or "").replace("&amp;", "&").strip()


def credit_for(title: str) -> tuple[str, str]:
    """Return (sourceUrl, credit) for a Commons file title."""
    url = "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"))
    params = {"action": "query", "format": "json", "titles": title, "prop": "imageinfo",
              "iiprop": "extmetadata", "iiextmetadatafilter": "Artist|LicenseShortName"}
    try:
        req = urllib.request.Request(API + "?" + urllib.parse.urlencode(params), headers=UA)
        with urllib.request.urlopen(req, timeout=40) as r:
            data = json.load(r)
        page = next(iter((data.get("query") or {}).get("pages", {}).values()))
        meta = ((page.get("imageinfo") or [{}])[0]).get("extmetadata", {})
        artist = strip_html(meta.get("Artist", {}).get("value", "")) or "Wikimedia Commons"
        license_ = strip_html(meta.get("LicenseShortName", {}).get("value", "")) or "CC BY-SA 4.0"
        return url, f"{artist} / Wikimedia Commons, {license_}"
    except Exception:  # noqa: BLE001
        return url, "Wikimedia Commons"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("slugs", nargs="*")
    args = ap.parse_args()

    ranking = json.loads((WORK / "ranking.json").read_text(encoding="utf-8"))
    data = json.loads((LIBRARY / "players.json").read_text(encoding="utf-8"))
    by_id = {p["id"]: p for p in data["players"]}
    slugs = args.slugs or list(ranking)

    for slug in slugs:
        entry = ranking.get(slug)
        src_cut = WORK / "cut" / f"{slug}.png"
        if not src_cut.exists():
            print(f"skip {slug}: no cutout")
            continue
        d = LIBRARY / slug
        d.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src_cut, d / "cutout.png")
        photo = None
        if entry:
            photo = WORK / "raw" / slug / f"{entry['best']['idx']}.jpg"
            if photo.exists():
                shutil.copy2(photo, d / "photo.jpg")
        title = entry["best"]["title"] if entry else None
        url, credit = credit_for(title) if title else ("", "")
        if slug in NEW_PLAYERS:
            by_id.setdefault(slug, {"id": slug, **NEW_PLAYERS[slug], "sourceUrl": "", "sourceCredit": ""})
        if slug in by_id:
            by_id[slug]["sourceUrl"] = url
            by_id[slug]["sourceCredit"] = credit
        print(f"imported {slug}: photo={photo.name if photo else '-'} | {credit[:70]}")

    # keep NEW_PLAYERS insertion order stable and appended after existing ones
    ordered = [p for p in data["players"] if p["id"] in by_id]
    for slug in by_id:
        if slug not in {p["id"] for p in ordered}:
            ordered.append(by_id[slug])
    data["players"] = ordered
    (LIBRARY / "players.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"players.json: {len(ordered)} players")


if __name__ == "__main__":
    main()
