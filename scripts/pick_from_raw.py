"""Override the auto-picked cutout/photo for one player from the raw candidate pool.

Use when the per-candidate ranker picks an acceptable-but-not-great photo. The
"right" choice is usually obvious from a candidate montage — pick the single,
front-facing, clean-background image by index.

    python scripts/pick_from_raw.py <slug> <candidate-index> [<slug> <index> ...]
"""
from __future__ import annotations
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "cards" / "_work" / "raw"
LIB = ROOT / "cards" / "library"
sys.path.insert(0, str(ROOT / "scripts"))
from make_cutout import cut  # noqa: E402

PAIRS = []
i = 1
while i + 1 < len(sys.argv):
    PAIRS.append((sys.argv[i], int(sys.argv[i + 1])))
    i += 2
if not PAIRS:
    raise SystemExit(__doc__)

for slug, idx in PAIRS:
    src = RAW / slug / f"{idx}.jpg"
    if not src.exists():
        print("  ! missing:", src); continue
    lib = LIB / slug; lib.mkdir(parents=True, exist_ok=True)
    cut_path = lib / "cutout.png"; photo_path = lib / "photo.jpg"
    print("[", slug, "] ->", src.name)
    cut(src, cut_path)
    shutil.copy2(src, photo_path)
    print("  wrote", cut_path.name, "and", photo_path.name)
