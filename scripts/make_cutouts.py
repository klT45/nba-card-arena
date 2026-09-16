"""Batch-matte every player photo in the library.

    python scripts/make_cutouts.py                # only players missing a cutout
    python scripts/make_cutouts.py --force        # rebuild every cutout
    python scripts/make_cutouts.py --only curry   # substring match on ids
    python scripts/make_cutouts.py --model u2net_human_seg

Reads ``cards/library/<id>/photo.<ext>`` and writes
``cards/library/<id>/cutout.png``. BiRefNet is the default: it keeps the subject
clean instead of merging nearby spectators into the matte.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_cutout import DEFAULT_MODEL, cut  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
LIBRARY = ROOT / "cards" / "library"
EXTS = ("jpg", "jpeg", "png", "webp")


def find_photo(pid: str) -> Path | None:
    for e in EXTS:
        p = LIBRARY / pid / f"photo.{e}"
        if p.exists():
            return p
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="rebuild even if cutout.png exists")
    ap.add_argument("--only", help="comma-separated id substrings")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    args = ap.parse_args()

    players = json.loads((LIBRARY / "players.json").read_text(encoding="utf-8"))["players"]
    only = [s.strip() for s in args.only.split(",")] if args.only else None
    targets = [p for p in players if not only or any(o in p["id"] for o in only)]

    done = skipped = 0
    for p in targets:
        pid = p["id"]
        dst = LIBRARY / pid / "cutout.png"
        if dst.exists() and not args.force:
            print("skip", pid)
            skipped += 1
            continue
        photo = find_photo(pid)
        if not photo:
            print("  ! no photo for", pid)
            continue
        cut(photo, dst, args.model)
        print("cut ", pid, f"<- {photo.name}")
        done += 1
    print(f"cutouts: {done} rebuilt, {skipped} skipped, model={args.model}")


if __name__ == "__main__":
    main()
