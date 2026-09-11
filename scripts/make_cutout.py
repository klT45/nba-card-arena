"""Matte one photo with rembg's human-segmentation model.

    python scripts/make_cutout.py <photo> <out.png>

Called by the admin dev API on upload; can also be run by hand per player.
Requires the `rembg` + `onnxruntime` Python packages (model downloads on first use).
"""
from __future__ import annotations

import sys
from pathlib import Path


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit("usage: make_cutout.py <photo> <out.png>")
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    from rembg import new_session, remove
    from PIL import Image

    session = new_session("u2net_human_seg")
    cut = remove(Image.open(src).convert("RGBA"), session=session)
    if max(cut.size) > 1500:
        cut.thumbnail((1500, 1500), Image.LANCZOS)
    dst.parent.mkdir(parents=True, exist_ok=True)
    cut.save(dst, optimize=True)
    print(f"cutout -> {dst} {cut.size}")


if __name__ == "__main__":
    main()
