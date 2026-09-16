"""Matte one photo with rembg's segmentation model.

    python scripts/make_cutout.py <photo> <out.png> [model]

Called by the admin dev API on upload; can also be run by hand per player.
Requires the `rembg` + `onnxruntime` Python packages (models download on first use).

``birefnet-general-lite`` is the default: it produces a single, clean person
matte where ``u2net_human_seg`` used to merge spectators into the subject.
"""
from __future__ import annotations

import sys
from pathlib import Path

DEFAULT_MODEL = "birefnet-general-lite"


def cut(src: Path, dst: Path, model: str = DEFAULT_MODEL) -> Path:
    from rembg import new_session, remove
    from PIL import Image

    session = new_session(model)
    img = Image.open(src).convert("RGBA")
    if max(img.size) > 1200:  # keep inference reasonable on CPU (BiRefNet is RAM hungry)
        img.thumbnail((1200, 1200), Image.LANCZOS)
    out = remove(img, session=session)
    dst.parent.mkdir(parents=True, exist_ok=True)
    out.save(dst, optimize=True)
    return dst


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit("usage: make_cutout.py <photo> <out.png> [model]")
    model = sys.argv[3] if len(sys.argv) > 3 else DEFAULT_MODEL
    dst = cut(Path(sys.argv[1]), Path(sys.argv[2]), model)
    from PIL import Image
    print(f"cutout -> {dst} {Image.open(dst).size} [{model}]")


if __name__ == "__main__":
    main()
