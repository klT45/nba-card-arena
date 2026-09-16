"""Re-tier the roster so rarity actually means something.

Before this the roster was 12 MYTHIC / 2 ELITE, and the draw was a uniform pick
over all players — so "MYTHIC" came up ~86% of the time and the badge was pure
decoration. This sets an explicit three-tier split, which the weighted draw in
src/core.js then turns into a real rarity curve.

    python scripts/retier.py            # apply
    python scripts/retier.py --dry-run  # show what would change

Rarity is per-player editable in /admin.html, so treat this as a starting
point rather than gospel.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIBRARY = ROOT / "cards" / "library" / "players.json"

# Tier by career standing. Kept deliberately small at the top: a 3/5/6/8 split
# gives the weighted draw in src/core.js room to feel different per tier.
# RARE is NOT the bottom rung - COMMON is - which is what keeps "RARE" from
# reading backwards against the usual TCG ladder.
TIERS = {
    "MYTHIC": ["lebron-james", "stephen-curry", "kevin-durant"],
    "ELITE": [
        "nikola-jokic", "giannis-antetokounmpo", "luka-doncic",
        "shai-gilgeous-alexander", "jayson-tatum",
    ],
    "RARE": [
        "victor-wembanyama", "anthony-edwards", "anthony-davis",
        "joel-embiid", "devin-booker", "tyrese-haliburton",
    ],
    "COMMON": [
        "darius-garland", "trae-young", "cade-cunningham", "josh-giddey",
        "franz-wagner", "evan-mobley", "alperen-sengun", "rudy-gobert",
    ],
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    data = json.loads(LIBRARY.read_text(encoding="utf-8"))
    tier_of = {pid: tier for tier, ids in TIERS.items() for pid in ids}

    known = {p["id"] for p in data["players"]}
    unknown = set(tier_of) - known
    if unknown:
        raise SystemExit(f"TIERS lists ids not in the library: {sorted(unknown)}")
    unlisted = known - set(tier_of)
    if unlisted:
        raise SystemExit(f"library has players with no tier: {sorted(unlisted)}")

    changed = 0
    for p in data["players"]:
        want = tier_of[p["id"]]
        if p.get("rarity") != want:
            print(f"  {p['id']:28s} {p.get('rarity', '-'):7s} -> {want}")
            p["rarity"] = want
            changed += 1

    print(f"{changed} of {len(data['players'])} changed")
    if args.dry_run:
        print("(dry run - nothing written)")
        return
    LIBRARY.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {LIBRARY.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
