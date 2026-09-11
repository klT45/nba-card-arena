"""Batch-matte library photos that do not have a cutout yet.

    python scripts/make_cutouts.py            # only missing cutouts
    python scripts/make_cutouts.py --force    # redo every player
    python scripts/make_cutouts.py --only curry,durant

Useful when adding many players at once: drop `cards/library/<id>/photo.jpg`
for each, run this, then `npm run build:cards`.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LIBRARY = ROOT / "cards" / "library"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="re-matte even if cutout.png exists")
    ap.add_argument("--only", help="comma-separated id substrings")
    args = ap.parse_args()

    players = json.loads((LIBRARY / "players.json").read_text(encoding="utf-8"))["players"]
    only = [s.strip() for s in args.only.split(",")] if args.only else None
    todo = []
    for p in players:
        if only and not any(o in p["id"] for o in only):
            continue
        d = LIBRARY / p["id"]
        photo = next((d / f"photo.{e}" for e in ("jpg", "jpeg", "png") if (d / f"photo.{e}").exists()), None)
        if photo is None:
            print(f"skip {p['id']}: no photo")
            continue
        if (d / "cutout.png").exists() and not args.force:
            print(f"skip {p['id']}: cutout exists")
            continue
        todo.append((p["id"], photo, d / "cutout.png"))

    if not todo:
        print("nothing to do")
        return
    from rembg import new_session, remove
    from PIL import Image

    session = new_session("u2net_human_seg")
    for pid, photo, out in todo:
        cut = remove(Image.open(photo).convert("RGBA"), session=session)
        if max(cut.size) > 1500:
            cut.thumbnail((1500, 1500), Image.LANCZOS)
        cut.save(out, optimize=True)
        print(f"matted {pid} -> {out.relative_to(ROOT)} {cut.size}")


if __name__ == "__main__":
    main()
