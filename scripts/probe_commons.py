"""Dry-run the sourcer: how many usable photos does Commons actually have?

Sourcing a player costs ~10 downloads plus a BiRefNet inference each, so it is
worth checking first whether a candidate has real game photos at all. This
reuses source_players.py's category lookup and its exact filters (jpeg, wider
than 1400px, basketball category, no other player's name in the title) and just
counts what survives.

    python scripts/probe_commons.py Bam Adebayo Rudy Gobert
    python scripts/probe_commons.py --file candidates.txt
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import source_players as sp  # noqa: E402


def usable(slug: str, name: str, limit: int) -> tuple[str, list[dict]] | tuple[None, None]:
    cat = sp.CATEGORY.get(slug) or sp.find_category(name)
    if not cat:
        return None, None
    rows = sp.candidates(slug, name) if cat else []
    return cat, rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("names", nargs="+", help="'First Last' pairs, or slugs with --slugs")
    ap.add_argument("--slugs", action="store_true", help="args are slugs; derive the name")
    ap.add_argument("--limit", type=int, default=6, help="titles to print per player")
    args = ap.parse_args()

    if args.slugs:
        pairs = [(a, a.replace("-", " ").title()) for a in args.names]
    else:
        if len(args.names) % 2:
            raise SystemExit("give 'First Last' pairs, or pass --slugs")
        pairs = [(args.names[i] + "-" + args.names[i + 1],
                  args.names[i] + " " + args.names[i + 1])
                 for i in range(0, len(args.names), 2)]
        pairs = [(a.lower(), b) for a, b in pairs]

    print(f"{'slug':30s} {'usable':>6s}  category")
    print("-" * 100)
    for slug, name in pairs:
        try:
            cat, rows = usable(slug, name, args.limit)
        except Exception as exc:  # noqa: BLE001 - one bad name must not stop the sweep
            print(f"{slug:30s}   ERROR  {type(exc).__name__}: {str(exc)[:50]}")
            continue
        if cat is None:
            print(f"{slug:30s}       0  (no category found)")
            continue
        flag = "  <<< thin" if len(rows) < 3 else ""
        print(f"{slug:30s} {len(rows):6d}  {cat}{flag}")
        for r in rows[:args.limit]:
            print(f"{'':30s}        {r['w']}x{r['h']} ar={r['ar']:.2f}  {r['title'][5:][:76]}")


if __name__ == "__main__":
    main()
