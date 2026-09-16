"""Build a contact sheet of every generated card face for quick visual review.

Usage:
    python scripts/contact_sheet.py                 # all players
    python scripts/contact_sheet.py --only jokic,tatum
    python scripts/contact_sheet.py --out output/shots/contact-sheet.png

The sheet renders the *live* composited face (front.webp) next to the raw
cut-out subject and the photo-derived background, so it is obvious at a glance
whether a player got a bad source photo.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public" / "cards"
DEFAULT_OUT = ROOT / "output" / "shots" / "contact-sheet.png"

BG = (18, 20, 24)
PANEL = (28, 31, 37)
INK = (238, 240, 244)
MUTED = (150, 156, 166)
BRAND = (201, 255, 61)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    names = ["bahnschrift.ttf", "segoeui.ttf", "arial.ttf"]
    for n in names:
        p = Path("C:/Windows/Fonts") / n
        if p.exists():
            try:
                f = ImageFont.truetype(str(p), size)
                if bold and n == "bahnschrift.ttf":
                    try:
                        f.set_variation_by_name("Bold Condensed")
                    except Exception:  # noqa: BLE001
                        pass
                return f
            except Exception:  # noqa: BLE001
                continue
    return ImageFont.load_default()


def load(path: Path, size: tuple[int, int]) -> Image.Image | None:
    if not path.exists():
        return None
    im = Image.open(path).convert("RGBA")
    im.thumbnail(size, Image.LANCZOS)
    tile = Image.new("RGBA", size, PANEL + (255,))
    tile.alpha_composite(im, ((size[0] - im.width) // 2, (size[1] - im.height) // 2))
    return tile.convert("RGB")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated id substrings")
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--cols", type=int, default=5)
    args = ap.parse_args()

    manifest = json.loads((PUBLIC / "manifest.json").read_text(encoding="utf-8"))
    only = [s.strip() for s in args.only.split(",")] if args.only else None
    players = [p for p in manifest["players"] if not only or any(o in p["id"] for o in only)]
    if not players:
        raise SystemExit(f"no players matched --only {args.only}")

    # face | subject | background triplets per player
    tile_w, tile_h = 300, 438
    cols = max(1, min(args.cols, len(players)))
    rows = (len(players) + cols - 1) // cols
    gap, pad, label_h = 14, 26, 46
    header_h = 74
    cell_w = tile_w * 3 + gap * 2
    cell_h = tile_h + label_h
    width = pad * 2 + cols * cell_w + (cols - 1) * gap * 2
    height = header_h + pad + rows * cell_h + (rows - 1) * gap * 2 + pad

    sheet = Image.new("RGB", (width, height), BG)
    d = ImageDraw.Draw(sheet)
    d.text((pad, 18), "NBA CARD ARENA  /  CARD FACE REVIEW", font=font(30, True), fill=INK)
    d.text(
        (pad, 50),
        "each player: composited face  |  cut-out subject  |  photo background",
        font=font(15),
        fill=MUTED,
    )
    d.line([(pad, header_h - 8), (width - pad, header_h - 8)], fill=(60, 65, 74), width=1)

    f_name = font(21, True)
    f_meta = font(14)
    for i, p in enumerate(players):
        pid = p["id"]
        cx = pad + (i % cols) * (cell_w + gap * 2)
        cy = header_h + pad + (i // cols) * (cell_h + gap * 2)
        base = PUBLIC / pid

        imgs = [
            load(base / "front.webp", (tile_w, tile_h)),
            load(base / "subject.webp", (tile_w, tile_h)),
            load(base / "background.webp", (tile_w, tile_h)),
        ]
        for j, tile in enumerate(imgs):
            x = cx + j * (tile_w + gap)
            if tile is None:
                d.rectangle([x, cy, x + tile_w, cy + tile_h], fill=PANEL)
                d.text((x + 12, cy + 12), "missing", font=f_meta, fill=(200, 90, 90))
            else:
                sheet.paste(tile, (x, cy))

        d.text((cx, cy + tile_h + 6), pid, font=f_name, fill=INK)
        style = p.get("style", "arena")
        rarity = p.get("rarity", "")
        team = p.get("teamShort", "")
        d.text(
            (cx, cy + tile_h + 28),
            f"{style}  ·  {rarity}  ·  {team}".strip(" ·"),
            font=f_meta,
            fill=BRAND,
        )

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    print(f"sheet: {out}  ({width}x{height}, {len(players)} players)")


if __name__ == "__main__":
    main()
