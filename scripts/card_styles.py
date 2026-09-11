"""Card style presets.

Each preset defines a background recipe, a text palette and the shader parameters
used by the web viewer. Styles are derived from the holo-card-studio look
(``atelier`` is the skill's own navy/gold treatment) and can be selected per
player in ``cards/library/players.json``.
"""
from __future__ import annotations

import math
import zlib

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

STYLES: dict[str, dict] = {
    "arena": {
        "name": "霓虹竞技场",
        "desc": "深色球场渐变 + 光柱 + 团队色霓虹",
        "foil": 0.68, "subjectScale": 1.04, "subjectDepth": 0.30, "backgroundDepth": -0.18,
        "text": {"primary": (255, 255, 255), "accent": "player", "muted": (214, 219, 228)},
        "panel": (7, 10, 19, 228), "header": (7, 10, 19, 206), "outline_w": 3,
    },
    "atelier": {
        "name": "幻光典藏",
        "desc": "技能默认：墨蓝底 + 古金描边 + 菱纹",
        "foil": 0.62, "subjectScale": 1.03, "subjectDepth": 0.28, "backgroundDepth": -0.16,
        "text": {"primary": (255, 241, 206), "accent": (244, 208, 135), "muted": (198, 188, 166)},
        "panel": (9, 13, 22, 232), "header": (9, 13, 22, 210), "outline_w": 3,
    },
    "gold": {
        "name": "鎏金典藏",
        "desc": "金属拉丝金 + 高亮金边",
        "foil": 0.8, "subjectScale": 1.05, "subjectDepth": 0.34, "backgroundDepth": -0.2,
        "text": {"primary": (255, 238, 196), "accent": (255, 206, 92), "muted": (228, 204, 150)},
        "panel": (18, 12, 3, 234), "header": (18, 12, 3, 212), "outline_w": 4,
    },
    "ink": {
        "name": "水墨",
        "desc": "宣纸米白 + 墨晕 + 朱红印章",
        "foil": 0.4, "subjectScale": 1.04, "subjectDepth": 0.26, "backgroundDepth": -0.14,
        "text": {"primary": (243, 238, 228), "accent": (198, 62, 52), "muted": (176, 170, 158)},
        "panel": (24, 22, 20, 236), "header": (24, 22, 20, 214), "outline_w": 3,
    },
    "prism": {
        "name": "棱镜虹彩",
        "desc": "高饱和多色渐变 + 强虹光",
        "foil": 0.95, "subjectScale": 1.05, "subjectDepth": 0.36, "backgroundDepth": -0.22,
        "text": {"primary": (255, 255, 255), "accent": "player", "muted": (226, 231, 242)},
        "panel": (10, 12, 22, 230), "header": (10, 12, 22, 208), "outline_w": 3,
    },
}

STYLE_ORDER = ["arena", "atelier", "gold", "ink", "prism"]


def style_list() -> list[dict]:
    return [{"id": k, "name": STYLES[k]["name"], "desc": STYLES[k]["desc"]} for k in STYLE_ORDER]


def params(style_id: str) -> dict:
    s = STYLES.get(style_id) or STYLES["arena"]
    return {
        "foil": s["foil"], "subjectScale": s["subjectScale"],
        "subjectDepth": s["subjectDepth"], "backgroundDepth": s["backgroundDepth"],
    }


# --------------------------------------------------------------- helpers ----
def _rng(pid: str) -> np.random.Generator:
    return np.random.default_rng(zlib.crc32(pid.encode()))


def _vgrad(im: Image.Image, top, bottom) -> None:
    d = ImageDraw.Draw(im, "RGBA")
    for y in range(im.height):
        t = y / im.height
        d.line((0, y, im.width, y), fill=tuple(int(top[i] * (1 - t) + bottom[i] * t) for i in range(3)) + (255,))


def _multi_grad(im: Image.Image, stops: list[tuple[float, tuple]]) -> None:
    d = ImageDraw.Draw(im, "RGBA")
    h = im.height
    for y in range(h):
        t = y / h
        for i in range(len(stops) - 1):
            t0, c0 = stops[i]
            t1, c1 = stops[i + 1]
            if t0 <= t <= t1:
                k = (t - t0) / max(1e-6, t1 - t0)
                col = tuple(int(c0[j] * (1 - k) + c1[j] * k) for j in range(3))
                break
        else:
            col = stops[-1][1]
        d.line((0, y, im.width, y), fill=col + (255,))


def _diag_grad(im: Image.Image, stops: list[tuple]) -> None:
    """Angle gradient across u+v, for the prism style."""
    d = ImageDraw.Draw(im, "RGBA")
    for i in range(0, im.width + im.height, 3):
        t = i / (im.width + im.height)
        seg = min(int(t * (len(stops) - 1)), len(stops) - 2)
        k = t * (len(stops) - 1) - seg
        c0, c1 = stops[seg], stops[seg + 1]
        col = tuple(int(c0[j] * (1 - k) + c1[j] * k) for j in range(3))
        d.line((i, 0, i - im.height, im.height), fill=col + (255,))


def _glow(im: Image.Image, color, alpha: int, blur: int, box=None) -> Image.Image:
    w, h = im.size
    g = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(g, "RGBA").ellipse(box or (-w * 0.3, h * 0.02, w * 1.3, h * 0.98), fill=(*color, alpha))
    return Image.alpha_composite(im, g.filter(ImageFilter.GaussianBlur(blur)))


def _rays(im: Image.Image, alpha: int, blur: int = 26) -> Image.Image:
    w, h = im.size
    r = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(r, "RGBA")
    for i in range(-7, 11):
        x = i * w * 0.15
        d.polygon([(x, 0), (x + w * 0.05, 0), (x - h * 0.30, h), (x - h * 0.38, h)], fill=(255, 255, 255, alpha))
    return Image.alpha_composite(im, r.filter(ImageFilter.GaussianBlur(blur)))


def _bokeh(im: Image.Image, colors, rng, count=170) -> Image.Image:
    w, h = im.size
    b = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(b, "RGBA")
    for _ in range(count):
        x, y = int(rng.integers(0, w)), int(rng.normal(h * 0.30, h * 0.15))
        rad = int(rng.integers(3, 15))
        col = colors[int(rng.integers(0, len(colors)))]
        d.ellipse((x - rad, y - rad, x + rad, y + rad), fill=(*col, int(rng.integers(22, 78))))
    return Image.alpha_composite(im, b.filter(ImageFilter.GaussianBlur(10)))


def _arcs(im: Image.Image, color, alpha: int, width: int = 11) -> None:
    w, h = im.size
    d = ImageDraw.Draw(im, "RGBA")
    d.ellipse((-w * 0.25, h * 0.84, w * 1.25, h * 1.16), outline=(*color, alpha), width=width)
    d.ellipse((-w * 0.08, h * 0.90, w * 1.08, h * 1.20), outline=(255, 255, 255, max(0, alpha // 3)), width=3)


def _watermark(im: Image.Image, p: dict, font_factory, color, alpha: int) -> None:
    w, h = im.size
    d = ImageDraw.Draw(im, "RGBA")
    d.text((w - 62, 118), p["teamShort"], font=font_factory(148, True), anchor="ra", fill=(*color, alpha))
    d.text((w - 56, 292), str(p["number"]), font=font_factory(228, True), anchor="ra", fill=(*color, max(8, alpha - 4)))


# ------------------------------------------------------------ background ----
def render_background(p: dict, style_id: str, subject_bbox, size, font_factory) -> Image.Image:
    W, H = size
    s = STYLES.get(style_id) or STYLES["arena"]
    accent = _hex(p["accent"])
    accent2 = _hex(p["accent2"])
    rng = _rng(p["id"])
    im = Image.new("RGBA", (W, H), (*accent2, 255))

    if style_id == "ink":
        _vgrad(im, (244, 238, 226), (214, 205, 190))
        wash = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        wd = ImageDraw.Draw(wash, "RGBA")
        for _ in range(9):
            x, y = int(rng.integers(-100, W)), int(rng.integers(0, H))
            rx, ry = int(rng.integers(120, 380)), int(rng.integers(90, 280))
            wd.ellipse((x - rx, y - ry, x + rx, y + ry), fill=(38, 40, 48, int(rng.integers(10, 26))))
        im = Image.alpha_composite(im, wash.filter(ImageFilter.GaussianBlur(60)))
        d = ImageDraw.Draw(im, "RGBA")
        for y in range(120, H, 96):
            d.line((0, y, W, y), fill=(60, 58, 54, 12), width=2)
        d.rounded_rectangle((46, 46, W - 46, H - 46), radius=14, outline=(40, 38, 36, 150), width=3)
        d.rectangle((W - 210, 150, W - 130, 246), outline=(176, 52, 44, 220), width=7)
        _watermark(im, p, font_factory, (40, 38, 36), 22)
    elif style_id == "gold":
        _vgrad(im, (74, 52, 10), (16, 11, 3))
        im = _glow(im, (255, 206, 92), 60, 150)
        streaks = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        sd = ImageDraw.Draw(streaks, "RGBA")
        for _ in range(140):
            y = int(rng.integers(0, H))
            sd.line((0, y, W, y), fill=(255, 226, 150, int(rng.integers(6, 26))), width=int(rng.integers(1, 3)))
        im = Image.alpha_composite(im, streaks.filter(ImageFilter.GaussianBlur(2)))
        im = _rays(im, 14, 30)
        _arcs(im, (255, 206, 92), 120, 12)
        _watermark(im, p, font_factory, (255, 214, 120), 26)
    elif style_id == "prism":
        _diag_grad(im, [(10, 14, 32), (34, 20, 78), (10, 74, 96), (86, 22, 74), (12, 16, 34)])
        im = _glow(im, (255, 255, 255), 46, 170, box=(-W * 0.2, H * 0.05, W * 1.2, H * 0.9))
        im = _rays(im, 16, 22)
        im = _bokeh(im, [(255, 120, 190), (120, 220, 255), (255, 220, 130)], rng, 150)
        _arcs(im, (255, 255, 255), 70, 8)
        _watermark(im, p, font_factory, (255, 255, 255), 26)
    elif style_id == "atelier":
        _vgrad(im, (14, 22, 42), (5, 7, 13))
        im = _glow(im, (244, 208, 135), 40, 160, box=(-W * 0.25, H * 0.06, W * 1.25, H * 0.94))
        im = _bokeh(im, [(244, 208, 135), (255, 255, 255)], rng, 120)
        d = ImageDraw.Draw(im, "RGBA")
        d.rounded_rectangle((44, 44, W - 44, H - 44), radius=26, outline=(244, 208, 135, 120), width=3)
        d.rounded_rectangle((62, 62, W - 62, H - 62), radius=18, outline=(244, 208, 135, 60), width=1)
        cx, cy = W // 2, int(H * 0.42)
        for rad in (300, 250):
            d.regular_polygon((cx, cy, rad), 4, rotation=0, outline=(244, 208, 135, 40))
        _watermark(im, p, font_factory, (244, 208, 135), 22)
    else:  # arena
        _vgrad(im, accent2, (6, 8, 14))
        im = _glow(im, accent, 58, 150)
        im = _rays(im, 11, 26)
        im = _bokeh(im, [accent, (255, 255, 255)], rng, 170)
        _arcs(im, accent, 95, 11)
        _watermark(im, p, font_factory, accent, 30)

    # shared: header strip + bottom name panel + subject drop shadow
    d = ImageDraw.Draw(im, "RGBA")
    hdr = s["header"]
    d.rectangle((0, 0, W, int(H * 0.085)), fill=hdr)
    d.line((0, int(H * 0.085), W, int(H * 0.085)), fill=_outline(s, accent, 140), width=2)
    panel_top = int(H * 0.80)
    d.rounded_rectangle((44, panel_top, W - 44, H - 44), radius=30, fill=s["panel"],
                        outline=_outline(s, accent, 255), width=s["outline_w"])
    d.line((44, panel_top + int(H * 0.026), W - 44, panel_top + int(H * 0.026)), fill=(255, 255, 255, 34), width=2)
    x, y, sw, sh = subject_bbox
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow, "RGBA").ellipse(
        (x + sw * 0.05, y + sh * 0.80, x + sw * 0.95, y + sh * 1.02), fill=(0, 0, 0, 150 if style_id != "ink" else 90))
    return Image.alpha_composite(im, shadow.filter(ImageFilter.GaussianBlur(38)))


def _hex(value: str) -> tuple[int, int, int]:
    v = value.lstrip("#")
    return tuple(int(v[i:i + 2], 16) for i in (0, 2, 4))


def _outline(style: dict, accent, alpha: int):
    a = style["text"]["accent"]
    col = accent if a == "player" else a
    return (*col, alpha)


def text_palette(style_id: str, accent_hex: str) -> dict:
    s = STYLES.get(style_id) or STYLES["arena"]
    t = s["text"]
    accent = _hex(accent_hex) if t["accent"] == "player" else t["accent"]
    return {"primary": t["primary"], "accent": accent, "muted": t["muted"]}
