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
    "atelier": {
        "name": "暗物质 · Dark Matter",
        "desc": "2K顶级神卡：黑曜宇宙深空 + 暗紫电离星云 + 银河电浆光弧",
        "foil": 1.15, "subjectScale": 1.05, "subjectDepth": 0.36, "backgroundDepth": -0.24,
        "text": {"primary": (255, 255, 255), "accent": (220, 120, 255), "muted": (195, 175, 235)},
        "panel": (12, 6, 28, 238), "header": (10, 5, 22, 220), "outline_w": 4,
    },
    "prism": {
        "name": "银河欧泊 · Galaxy Opal",
        "desc": "2K宝石神卡：极光母贝晶体 + 晶钻晶格折射 + 晶莹棱面",
        "foil": 1.00, "subjectScale": 1.05, "subjectDepth": 0.34, "backgroundDepth": -0.20,
        "text": {"primary": (242, 255, 255), "accent": (0, 255, 220), "muted": (165, 235, 240)},
        "panel": (6, 22, 32, 236), "header": (5, 18, 28, 215), "outline_w": 3,
    },
    "arena": {
        "name": "炼狱风暴 · Inferno",
        "desc": "2K狂暴进攻：火山熔岩地裂 + 炽红高温热浪 + 升腾火星",
        "foil": 0.90, "subjectScale": 1.05, "subjectDepth": 0.32, "backgroundDepth": -0.18,
        "text": {"primary": (255, 246, 232), "accent": (255, 95, 25), "muted": (255, 178, 110)},
        "panel": (24, 6, 2, 240), "header": (18, 5, 2, 218), "outline_w": 4,
    },
    "gold": {
        "name": "无敌至臻 · Invincible",
        "desc": "2K满评天花板：名人堂纯金拉丝 + 耀世晶体金芒 + 纯金高亮框",
        "foil": 0.88, "subjectScale": 1.05, "subjectDepth": 0.34, "backgroundDepth": -0.20,
        "text": {"primary": (255, 240, 205), "accent": (255, 208, 95), "muted": (228, 204, 150)},
        "panel": (20, 14, 4, 236), "header": (18, 12, 3, 215), "outline_w": 4,
    },
    "ink": {
        "name": "赛博错位 · Glitched",
        "desc": "2K错位卡系列：深空碳纤 + RGB色散位移 + 电子故障扫描线",
        "foil": 0.94, "subjectScale": 1.05, "subjectDepth": 0.32, "backgroundDepth": -0.18,
        "text": {"primary": (255, 255, 255), "accent": (0, 245, 255), "muted": (255, 115, 185)},
        "panel": (8, 10, 18, 238), "header": (6, 8, 16, 218), "outline_w": 3,
    },
}

STYLE_ORDER = ["atelier", "prism", "arena", "gold", "ink"]


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
        # 赛博错位 (Glitched · 2K): 深空碳纤 + RGB 色散位移 + 电子故障扫描线
        _vgrad(im, (8, 10, 20), (3, 4, 8))
        # 赛博霓虹青与电光粉双色光晕
        im = _glow(im, (0, 240, 255), 55, 120, box=(-W * 0.2, H * 0.15, W * 0.7, H * 0.75))
        im = _glow(im, (255, 0, 128), 50, 120, box=(W * 0.3, H * 0.25, W * 1.2, H * 0.85))
        # 故障横向色块与扫描线切片
        glitch = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glitch, "RGBA")
        for _ in range(35):
            gy = int(rng.integers(60, H - 100))
            gh = int(rng.integers(2, 14))
            gx = int(rng.integers(-40, W - 100))
            gw = int(rng.integers(80, 360))
            col = (0, 245, 255, int(rng.integers(40, 110))) if rng.random() > 0.5 else (255, 0, 140, int(rng.integers(40, 110)))
            gd.rectangle((gx, gy, gx + gw, gy + gh), fill=col)
        # 细微扫描线
        for y in range(80, H - 80, 6):
            gd.line((0, y, W, y), fill=(255, 255, 255, 14), width=1)
        im = Image.alpha_composite(im, glitch)
        # 几何切角科技边框
        d = ImageDraw.Draw(im, "RGBA")
        d.polygon([(46, 70), (70, 46), (W - 70, 46), (W - 46, 70), (W - 46, H - 70), (W - 70, H - 46), (70, H - 46), (46, H - 70)], outline=(0, 245, 255, 120), width=2)
        _watermark(im, p, font_factory, (0, 245, 255), 24)

    elif style_id == "gold":
        # 无敌至臻 (Invincible · 2K): 名人堂顶级黑金 + 金属拉丝 + 耀世晶体金芒
        _vgrad(im, (54, 40, 10), (14, 10, 3))
        im = _glow(im, (255, 210, 95), 65, 140)
        streaks = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        sd = ImageDraw.Draw(streaks, "RGBA")
        for _ in range(160):
            y = int(rng.integers(0, H))
            sd.line((0, y, W, y), fill=(255, 230, 160, int(rng.integers(8, 30))), width=int(rng.integers(1, 3)))
        im = Image.alpha_composite(im, streaks.filter(ImageFilter.GaussianBlur(2)))
        im = _rays(im, 18, 28)
        _arcs(im, (255, 210, 95), 140, 12)
        d = ImageDraw.Draw(im, "RGBA")
        d.rounded_rectangle((48, 48, W - 48, H - 48), radius=24, outline=(255, 215, 110, 160), width=3)
        d.rounded_rectangle((60, 60, W - 60, H - 60), radius=16, outline=(255, 255, 255, 60), width=1)
        _watermark(im, p, font_factory, (255, 215, 110), 28)

    elif style_id == "prism":
        # 银河欧泊 (Galaxy Opal · 2K): 极光母贝晶体 + 晶钻晶格折射 + 晶莹棱面
        _diag_grad(im, [(6, 24, 38), (18, 54, 76), (10, 80, 88), (48, 24, 72), (8, 20, 34)])
        im = _glow(im, (0, 255, 220), 55, 150, box=(-W * 0.25, H * 0.06, W * 1.25, H * 0.9))
        im = _glow(im, (255, 130, 220), 45, 130, box=(W * 0.1, H * 0.2, W * 0.9, H * 0.7))
        # 晶体晶格折射线
        facets = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        fd = ImageDraw.Draw(facets, "RGBA")
        for i in range(-3, 8):
            fd.line((i * W * 0.25, 0, i * W * 0.25 + W * 0.4, H), fill=(255, 255, 255, 22), width=2)
            fd.line((W - i * W * 0.25, 0, W - i * W * 0.25 - W * 0.4, H), fill=(0, 255, 220, 20), width=2)
        im = Image.alpha_composite(im, facets)
        im = _bokeh(im, [(0, 255, 220), (255, 140, 230), (255, 255, 255), (120, 220, 255)], rng, 160)
        _arcs(im, (0, 255, 220), 85, 10)
        _watermark(im, p, font_factory, (0, 255, 220), 28)

    elif style_id == "atelier":
        # 暗物质 (Dark Matter · 2K): 黑曜宇宙深空 + 暗紫电离星云 + 银河电浆光弧
        _vgrad(im, (12, 5, 26), (3, 1, 8))
        im = _glow(im, (170, 50, 255), 75, 150, box=(-W * 0.3, H * 0.08, W * 1.3, H * 0.85))
        im = _glow(im, (50, 180, 255), 45, 110, box=(W * 0.15, H * 0.25, W * 0.85, H * 0.65))
        # 宇宙深空星尘
        im = _bokeh(im, [(220, 120, 255), (100, 200, 255), (255, 255, 255), (180, 90, 240)], rng, 220)
        # 离子电浆放射光柱
        im = _rays(im, 16, 24)
        # 暗物质切角菱形与双轨暗紫外框
        d = ImageDraw.Draw(im, "RGBA")
        d.rounded_rectangle((44, 44, W - 44, H - 44), radius=28, outline=(220, 120, 255, 140), width=3)
        d.rounded_rectangle((62, 62, W - 62, H - 62), radius=18, outline=(100, 200, 255, 70), width=1)
        cx, cy = W // 2, int(H * 0.42)
        for rad in (310, 260):
            d.regular_polygon((cx, cy, rad), 4, rotation=0, outline=(220, 120, 255, 45))
        _watermark(im, p, font_factory, (220, 120, 255), 26)

    else:  # arena -> 炼狱风暴 (Inferno · 2K): 火山熔岩地裂 + 炽红高温热浪 + 升腾火星
        _vgrad(im, (32, 8, 3), (10, 3, 2))
        im = _glow(im, (255, 75, 15), 70, 140, box=(-W * 0.2, H * 0.1, W * 1.2, H * 0.9))
        im = _glow(im, (255, 180, 20), 45, 100, box=(W * 0.1, H * 0.3, W * 0.9, H * 0.8))
        # 升腾火星余烬 (Ember particles)
        embers = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ed = ImageDraw.Draw(embers, "RGBA")
        for _ in range(160):
            ex = int(rng.integers(20, W - 20))
            ey = int(rng.integers(100, H))
            er = int(rng.integers(2, 8))
            ecol = (255, 220, 100) if rng.random() > 0.4 else (255, 90, 20)
            ed.ellipse((ex - er, ey - er, ex + er, ey + er), fill=(*ecol, int(rng.integers(35, 100))))
        im = Image.alpha_composite(im, embers.filter(ImageFilter.GaussianBlur(3)))
        im = _rays(im, 14, 25)
        _arcs(im, (255, 90, 20), 110, 12)
        _watermark(im, p, font_factory, (255, 90, 20), 30)

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
