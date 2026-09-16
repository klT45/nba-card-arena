"""Compose the per-device screenshots written by scripts/shot-devices.cjs into a
single overview sheet, so the responsive result can be checked at a glance
instead of opening 25 PNGs one at a time.

Usage: python scripts/device_sheet.py
Reads  output/shots/devices/<device>-<screen>.png
Writes output/shots/devices-sheet.png
"""

import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "output", "shots", "devices")
OUT = os.path.join(ROOT, "output", "shots", "devices-sheet.png")

# Row order is roughly small-screen first, and each entry is (slug, label).
DEVICES = [
    ("iphone-se", "iPhone SE  375x667"),
    ("iphone-14pro", "iPhone 14 Pro  393x852"),
    ("pixel7", "Pixel 7  412x915"),
    ("phone-landscape", "横屏手机  844x390"),
    ("ipad-mini", "iPad mini  768x1024"),
]

# Column order matches the reading order of a session: land, browse, draw, inspect.
SCREENS = [
    ("arena", "首页"),
    ("gallery", "展厅"),
    ("draw-pack", "抽卡 · 卡包"),
    ("draw-result", "抽卡 · 揭晓"),
    ("detail", "卡片详情"),
]

MARGIN = 30
LABEL_W = 140
CELL_W, CELL_H = 170, 250
GAP = 12
HEADER_H = 40
BG = (11, 14, 20)
LINE = (38, 44, 54)
TEXT = (196, 202, 212)
MUTED = (128, 135, 146)

FONT_PATHS = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\msyhl.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
]


def load_font(size):
    for path in FONT_PATHS:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def fit(img, box_w, box_h):
    """Scale to fit inside the cell without cropping, so no UI is silently cut off."""
    scale = min(box_w / img.width, box_h / img.height)
    size = (max(1, round(img.width * scale)), max(1, round(img.height * scale)))
    return img.resize(size, Image.LANCZOS)


def main():
    cols, rows = len(SCREENS), len(DEVICES)
    width = MARGIN * 2 + LABEL_W + cols * CELL_W + (cols - 1) * GAP
    height = MARGIN * 2 + HEADER_H + rows * CELL_H + (rows - 1) * GAP

    sheet = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(sheet)
    font = load_font(14)
    font_small = load_font(12)

    for c, (_, title) in enumerate(SCREENS):
        x = MARGIN + LABEL_W + c * (CELL_W + GAP)
        draw.text((x, MARGIN + 10), title, font=font, fill=TEXT)

    missing = []
    for r, (slug, label) in enumerate(DEVICES):
        y = MARGIN + HEADER_H + r * (CELL_H + GAP)
        draw.text((MARGIN, y + CELL_H // 2 - 10), label, font=font_small, fill=MUTED)
        draw.line([(MARGIN, y - GAP // 2), (width - MARGIN, y - GAP // 2)], fill=LINE)

        for c, (screen, _) in enumerate(SCREENS):
            x = MARGIN + LABEL_W + c * (CELL_W + GAP)
            path = os.path.join(SRC, f"{slug}-{screen}.png")
            if not os.path.exists(path):
                missing.append(os.path.basename(path))
                draw.rectangle([x, y, x + CELL_W, y + CELL_H], outline=LINE)
                continue
            with Image.open(path) as raw:
                shot = fit(raw.convert("RGB"), CELL_W, CELL_H)
            # Centre horizontally, pin to the top: the top of a page is what the
            # user actually sees before scrolling, so aligning tops makes the
            # rows comparable.
            sheet.paste(shot, (x + (CELL_W - shot.width) // 2, y))
            draw.rectangle([x, y, x + CELL_W, y + CELL_H], outline=LINE)

    sheet.save(OUT)
    print(f"wrote {OUT}  ({sheet.width}x{sheet.height})")
    if missing:
        print("missing:", ", ".join(missing))


if __name__ == "__main__":
    main()
