"""Build layered holographic card assets from sourced player cutouts.

For every player this produces the four equal-size layers the holo-card-studio
WebGL shader expects - ``background`` (full art), ``subject`` (alpha cutout),
``lineart`` (ink contours) and ``text`` (typography only) - plus a flat
``front``/``thumb`` composite for the gallery and the draw reveal.

Subjects come from ``cards/_work/cut/<slug>.png`` (produced by
``source_players.py`` with rembg's human-segmentation model). LeBron keeps the
original holo-card-studio artwork.
"""
from __future__ import annotations

import json
import shutil
import zlib
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
CUT = ROOT / "cards" / "_work" / "cut"
W, H = 1024, 1493
PANEL_TOP = int(H * 0.80)

PLAYERS = [
    {
        "id": "lebron-james", "name": "LeBron James", "number": "23", "team": "Los Angeles",
        "teamShort": "LAL", "positions": ["PG", "SF"], "positionsZh": ["控卫", "小前锋"],
        "rarity": "MYTHIC", "rating": 98, "accent": "#f6c547", "accent2": "#2a1b5e",
        "title": "THE CHOSEN ONE", "stats": {"finishing": 99, "shooting": 91, "playmaking": 97, "defense": 92},
        "subject": "file:cards/lebron-james-001/assets/subject.png",
        "sourceUrl": "https://pngdownload.io/png-image/lebron-james-in-lakers-jersey-nba-superstar-transparent-png-image/",
        "sourceCredit": "PNGDownload.io, CC BY-NC 4.0",
    },
    {
        "id": "stephen-curry", "name": "Stephen Curry", "number": "30", "team": "Golden State",
        "teamShort": "GSW", "positions": ["PG"], "positionsZh": ["控卫"],
        "rarity": "MYTHIC", "rating": 97, "accent": "#ffc72c", "accent2": "#132a5e",
        "title": "THE CHEF", "stats": {"finishing": 91, "shooting": 99, "playmaking": 96, "defense": 82},
        "subject": "cut:stephen-curry",
        "sourceUrl": "https://commons.wikimedia.org/wiki/File:Steph_Curry_(51915376334).jpg",
        "sourceCredit": "Erik Drost / Wikimedia Commons, CC BY 2.0",
    },
    {
        "id": "devin-booker", "name": "Devin Booker", "number": "1", "team": "Phoenix",
        "teamShort": "PHX", "positions": ["SG", "PG"], "positionsZh": ["分卫", "控卫"],
        "rarity": "ELITE", "rating": 94, "accent": "#ffb81c", "accent2": "#3d1a63",
        "title": "DESERT SNIPER", "stats": {"finishing": 92, "shooting": 96, "playmaking": 90, "defense": 84},
        "subject": "cut:devin-booker",
        "sourceUrl": "https://commons.wikimedia.org/wiki/File:Devin_Booker_(51915986756).jpg",
        "sourceCredit": "Erik Drost / Wikimedia Commons, CC BY 2.0",
    },
    {
        "id": "kevin-durant", "name": "Kevin Durant", "number": "35", "team": "Phoenix",
        "teamShort": "PHX", "positions": ["SF", "PF"], "positionsZh": ["小前锋", "大前锋"],
        "rarity": "MYTHIC", "rating": 97, "accent": "#ff6a13", "accent2": "#241456",
        "title": "SLIM REAPER", "stats": {"finishing": 96, "shooting": 98, "playmaking": 91, "defense": 89},
        "subject": "cut:kevin-durant",
        "sourceUrl": "https://commons.wikimedia.org/wiki/File:Kevin_Durant_(5).jpg",
        "sourceCredit": "Wikimedia Commons, CC BY-SA 4.0",
    },
    {
        "id": "giannis-antetokounmpo", "name": "Giannis Antetokounmpo", "number": "34", "team": "Milwaukee",
        "teamShort": "MIL", "positions": ["PF", "C"], "positionsZh": ["大前锋", "中锋"],
        "rarity": "MYTHIC", "rating": 97, "accent": "#e8dcc0", "accent2": "#0b3a1d",
        "title": "GREEK FREAK", "stats": {"finishing": 99, "shooting": 84, "playmaking": 91, "defense": 97},
        "subject": "cut:giannis-antetokounmpo",
        "sourceUrl": "https://commons.wikimedia.org/wiki/File:Giannis_Antetokounmpo_(51915516179).jpg",
        "sourceCredit": "Erik Drost / Wikimedia Commons, CC BY 2.0",
    },
    {
        "id": "nikola-jokic", "name": "Nikola Jokic", "number": "15", "team": "Denver",
        "teamShort": "DEN", "positions": ["C"], "positionsZh": ["中锋"],
        "rarity": "MYTHIC", "rating": 98, "accent": "#fec524", "accent2": "#0e2240",
        "title": "THE JOKER", "stats": {"finishing": 96, "shooting": 92, "playmaking": 99, "defense": 90},
        "subject": "cut:nikola-jokic",
        "sourceUrl": "https://commons.wikimedia.org/wiki/File:Nikola_Jokic_(51915490370).jpg",
        "sourceCredit": "Erik Drost / Wikimedia Commons, CC BY 2.0",
    },
    {
        "id": "luka-doncic", "name": "Luka Doncic", "number": "77", "team": "Los Angeles",
        "teamShort": "LAL", "positions": ["PG", "SG"], "positionsZh": ["控卫", "分卫"],
        "rarity": "MYTHIC", "rating": 97, "accent": "#7fc4f2", "accent2": "#002b5e",
        "title": "THE MAESTRO", "stats": {"finishing": 93, "shooting": 95, "playmaking": 98, "defense": 82},
        "subject": "cut:luka-doncic",
        "sourceUrl": "https://commons.wikimedia.org/wiki/File:Luka_Doncic_(51916605744).jpg",
        "sourceCredit": "Erik Drost / Wikimedia Commons, CC BY 2.0",
    },
    {
        "id": "jayson-tatum", "name": "Jayson Tatum", "number": "0", "team": "Boston",
        "teamShort": "BOS", "positions": ["SF", "PF"], "positionsZh": ["小前锋", "大前锋"],
        "rarity": "MYTHIC", "rating": 96, "accent": "#3ecf7a", "accent2": "#07321a",
        "title": "THE CLOSER", "stats": {"finishing": 94, "shooting": 93, "playmaking": 89, "defense": 91},
        "subject": "cut:jayson-tatum",
        "sourceUrl": "https://commons.wikimedia.org/wiki/File:Jayson_Tatum_(51916268559).jpg",
        "sourceCredit": "Erik Drost / Wikimedia Commons, CC BY 2.0",
    },
    {
        "id": "victor-wembanyama", "name": "Victor Wembanyama", "number": "1", "team": "San Antonio",
        "teamShort": "SAS", "positions": ["PF", "C"], "positionsZh": ["大前锋", "中锋"],
        "rarity": "MYTHIC", "rating": 96, "accent": "#cfd4da", "accent2": "#1b1e24",
        "title": "THE ALIEN", "stats": {"finishing": 92, "shooting": 90, "playmaking": 85, "defense": 99},
        "subject": "cut:victor-wembanyama",
        "sourceUrl": "https://commons.wikimedia.org/wiki/File:Victor_Wembanyama_(51915916671).jpg",
        "sourceCredit": "Erik Drost / Wikimedia Commons, CC BY 2.0",
    },
]


def hex_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    for name in (("arialbd.ttf", "calibrib.ttf") if bold else ("arial.ttf", "calibri.ttf")):
        path = Path("C:/Windows/Fonts") / name
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def fit_font(draw: ImageDraw.ImageDraw, text: str, max_w: int, size: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    while size > 10:
        f = font(size, bold)
        if draw.textlength(text, font=f) <= max_w:
            return f
        size -= 2
    return font(size, bold)


# ---------------------------------------------------------------- subject ---
def keep_subject(im: Image.Image, keep_ratio: float = 0.25) -> Image.Image:
    """Drop bystanders/objects the segmentation model also picked up."""
    rgba = np.array(im.convert("RGBA"))
    alpha = rgba[..., 3]
    mask = alpha > 64
    if mask.any():
        labels, count = ndimage.label(mask)
        if count > 1:
            sizes = ndimage.sum(mask, labels, range(1, count + 1))
            keep = np.isin(labels, [i + 1 for i, s in enumerate(sizes) if s >= sizes.max() * keep_ratio])
            rgba[..., 3] = np.where(keep, alpha, 0)
    out = Image.fromarray(rgba, "RGBA")
    bbox = out.getchannel("A").getbbox()
    return out.crop(bbox) if bbox else out


def load_subject(spec: str) -> Image.Image:
    if spec.startswith("file:"):
        im = Image.open(ROOT / spec[5:]).convert("RGBA")
    else:
        im = Image.open(CUT / f"{spec[4:]}.png").convert("RGBA")
    return keep_subject(im)


def place_subject(subject: Image.Image) -> tuple[Image.Image, tuple[int, int]]:
    """Scale the subject to ~80% card height and sit its feet near the bottom."""
    max_h, max_w = int(H * 0.80), int(W * 0.86)
    scale = min(max_h / subject.height, max_w / subject.width)
    nw, nh = max(1, int(subject.width * scale)), max(1, int(subject.height * scale))
    sub = subject.resize((nw, nh), Image.LANCZOS)
    return sub, ((W - nw) // 2, int(H * 0.985) - nh)


def layer_subject(sub: Image.Image, pos: tuple[int, int]) -> Image.Image:
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    layer.alpha_composite(sub, pos)
    return layer


# ------------------------------------------------------------- background ---
def build_background(p: dict, subject_bbox: tuple[int, int, int, int]) -> Image.Image:
    a, b = hex_rgb(p["accent"]), hex_rgb(p["accent2"])
    seed = zlib.crc32(p["id"].encode())
    rng = np.random.default_rng(seed)
    im = Image.new("RGBA", (W, H), (*b, 255))
    d = ImageDraw.Draw(im, "RGBA")
    for y in range(H):
        t = y / H
        d.line((0, y, W, y), fill=(*[int(b[i] * (1 - t * 0.78)) for i in range(3)], 255))
    # glow behind the subject
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow, "RGBA").ellipse((-W * 0.30, H * 0.02, W * 1.30, H * 0.98), fill=(*a, 58))
    im = Image.alpha_composite(im, glow.filter(ImageFilter.GaussianBlur(150)))
    # diagonal light shafts
    rays = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rays, "RGBA")
    for i in range(-7, 11):
        x = i * W * 0.15
        rd.polygon([(x, 0), (x + W * 0.05, 0), (x - H * 0.30, H), (x - H * 0.38, H)], fill=(255, 255, 255, 11))
    im = Image.alpha_composite(im, rays.filter(ImageFilter.GaussianBlur(26)))
    # arena bokeh
    bokeh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    bd = ImageDraw.Draw(bokeh, "RGBA")
    for _ in range(170):
        x, y = int(rng.integers(0, W)), int(rng.normal(H * 0.30, H * 0.15))
        r = int(rng.integers(3, 15))
        col = a if rng.random() < 0.7 else (255, 255, 255)
        bd.ellipse((x - r, y - r, x + r, y + r), fill=(*col, int(rng.integers(22, 78))))
    im = Image.alpha_composite(im, bokeh.filter(ImageFilter.GaussianBlur(10)))
    d = ImageDraw.Draw(im, "RGBA")
    # stage arcs
    d.ellipse((-W * 0.25, H * 0.84, W * 1.25, H * 1.16), outline=(*a, 95), width=11)
    d.ellipse((-W * 0.08, H * 0.90, W * 1.08, H * 1.20), outline=(255, 255, 255, 34), width=3)
    # team short + number watermark
    d.text((W - 62, 118), p["teamShort"], font=font(148, True), anchor="ra", fill=(255, 255, 255, 20))
    d.text((W - 56, 292), p["number"], font=font(228, True), anchor="ra", fill=(*a, 26))
    # header strip
    d.rectangle((0, 0, W, int(H * 0.085)), fill=(7, 10, 19, 208))
    d.line((0, int(H * 0.085), W, int(H * 0.085)), fill=(*a, 130), width=2)
    # bottom name panel
    d.rounded_rectangle((44, PANEL_TOP, W - 44, H - 44), radius=30, fill=(7, 10, 19, 226), outline=(*a, 255), width=3)
    d.line((44, PANEL_TOP + int(H * 0.026), W - 44, PANEL_TOP + int(H * 0.026)), fill=(255, 255, 255, 32), width=2)
    # subject drop shadow
    x, y, sw, sh = subject_bbox
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow, "RGBA").ellipse(
        (x + sw * 0.05, y + sh * 0.80, x + sw * 0.95, y + sh * 1.02), fill=(0, 0, 0, 150))
    return Image.alpha_composite(im, shadow.filter(ImageFilter.GaussianBlur(38)))


# ------------------------------------------------------------------ text ----
def build_text(p: dict) -> Image.Image:
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer, "RGBA")
    a = (*hex_rgb(p["accent"]), 255)
    pad = 62
    # header
    d.text((pad, int(H * 0.043)), p["team"].upper(), font=font(int(H * 0.030), True), anchor="lm", fill=a)
    d.text((W - pad, int(H * 0.043)), " / ".join(p["positions"]), font=font(int(H * 0.032), True),
           anchor="rm", fill=(255, 255, 255, 245))
    # panel copy
    rating_w = int(W * 0.20)
    name_size = int(H * 0.060)
    name_font = fit_font(d, p["name"].upper(), W - 2 * pad - rating_w, name_size)
    panel_pad = 34
    d.text((pad + panel_pad, PANEL_TOP + int(H * 0.048)), p["rarity"], font=font(int(H * 0.024), True), fill=a)
    d.text((pad + panel_pad, PANEL_TOP + int(H * 0.090)), p["name"].upper(), font=name_font, fill=(255, 255, 255, 255))
    d.text((pad + panel_pad, PANEL_TOP + int(H * 0.158)), p["title"], font=font(int(H * 0.026), True),
           fill=(214, 219, 228, 255))
    d.text((W - pad - panel_pad, PANEL_TOP + int(H * 0.118)), str(p["rating"]), font=font(int(H * 0.105), True),
           anchor="rm", fill=a)
    return layer


# ---------------------------------------------------------------- lineart ---
def build_lineart(subject_layer: Image.Image) -> Image.Image:
    alpha = np.asarray(subject_layer)[..., 3]
    edges = cv2.Canny(alpha, 50, 150)
    edges = cv2.dilate(edges, np.ones((2, 2), np.uint8), iterations=1)
    line = np.full((H, W), 255, np.uint8)
    line[edges > 0] = 0
    line = cv2.GaussianBlur(line, (3, 3), 0)
    return Image.fromarray(line, "L")


# ------------------------------------------------------------------- foil ---
def _value_noise(rng: np.random.Generator, cells: int) -> np.ndarray:
    small = rng.random((max(2, H // cells), max(2, W // cells))).astype(np.float32)
    im = Image.fromarray((small * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)
    return np.asarray(im).astype(np.float32) / 255.0


def bake_foil(base: Image.Image, seed: int) -> Image.Image:
    """Static iridescent sheen so the gallery/draw art still reads as foil."""
    rng = np.random.default_rng(seed)
    b = np.asarray(base.convert("RGB")).astype(np.float32) / 255.0
    ys, xs = np.mgrid[0:H, 0:W]
    u, v = xs / W, ys / H
    wave = 0.5 + 0.5 * np.sin((u * 0.848 + v * 0.530) * 6.283 * 1.65 + 7.0 * _value_noise(rng, 90))
    t = (wave * 0.8 + _value_noise(rng, 40) * 0.12) % 1.0
    pink, yellow, blue, white = (np.array(c, np.float32) for c in
                                 ((1, .32, .62), (1, .85, .32), (.22, .62, 1.), (1., 1., 1.)))
    foil = np.empty((H, W, 3), np.float32)
    m1, m2, m3 = t < .35, (t >= .35) & (t < .7), t >= .7
    foil[m1] = pink + (yellow - pink) * (t[m1, None] / .35)
    foil[m2] = yellow + (blue - yellow) * ((t[m2, None] - .35) / .35)
    foil[m3] = blue + (white - blue) * ((t[m3, None] - .7) / .3)
    overlay = np.where(b < .5, 2 * b * foil, 1 - 2 * (1 - b) * (1 - foil))
    out = b * 0.74 + overlay * 0.26
    sweep = np.power(np.clip(np.sin((u * 0.83 + v * 0.35) * 6.283), 0, None), 12)
    out = out + foil * sweep[..., None] * 0.16
    sparkle = np.where(_value_noise(rng, 6) > 0.986, 1.0, 0.0)
    out = np.clip(out + sparkle[..., None] * 0.5, 0, 1)
    return Image.fromarray((out * 255).astype(np.uint8), "RGB")


# ------------------------------------------------------------------ build ---
def build_player(p: dict) -> None:
    out = PUBLIC / "cards" / p["id"]
    (out / "layers").mkdir(parents=True, exist_ok=True)
    subject = load_subject(p["subject"])
    sub, pos = place_subject(subject)
    subject_layer = layer_subject(sub, pos)
    background = build_background(p, (pos[0], pos[1], sub.width, sub.height))
    text = build_text(p)
    lineart = build_lineart(subject_layer)

    # flat composite for gallery / draw / fallback
    flat = Image.alpha_composite(background, subject_layer).convert("RGB")
    flat = bake_foil(flat, zlib.crc32(p["id"].encode()))
    flat_rgba = Image.alpha_composite(flat.convert("RGBA"), text)
    flat_rgba.convert("RGB").save(out / "front.webp", "WEBP", quality=88, method=6)
    thumb = flat_rgba.convert("RGB").copy()
    thumb.thumbnail((430, 626), Image.LANCZOS)
    thumb.save(out / "thumb.webp", "WEBP", quality=80, method=6)

    background.save(out / "layers" / "background.png", optimize=True)
    subject_layer.save(out / "layers" / "subject.png", optimize=True)
    lineart.save(out / "layers" / "lineart.png", optimize=True)
    text.save(out / "layers" / "text.png", optimize=True)
    background.save(out / "background.webp", "WEBP", quality=84, method=6)
    subject.save(out / "subject.webp", "WEBP", quality=88, method=6)

    cfg = {k: v for k, v in p.items() if k != "subject"}
    cfg["assets"] = {
        "front": f"/cards/{p['id']}/front.webp",
        "thumb": f"/cards/{p['id']}/thumb.webp",
        "subject": f"/cards/{p['id']}/subject.webp",
        "background": f"/cards/{p['id']}/background.webp",
        "layers": {
            "subject": f"/cards/{p['id']}/layers/subject.png",
            "background": f"/cards/{p['id']}/layers/background.png",
            "lineart": f"/cards/{p['id']}/layers/lineart.png",
            "text": f"/cards/{p['id']}/layers/text.png",
        },
    }
    (out / "card.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    print("built", p["id"])


def copy_legacy() -> None:
    legacy = PUBLIC / "legacy" / "lebron"
    legacy.mkdir(parents=True, exist_ok=True)
    for name in ("index.html", "style.css", "app.js", "card-config.json"):
        shutil.copy2(ROOT / "cards" / "lebron-james-001" / "web" / name, legacy / name)
    html = (legacy / "index.html").read_text(encoding="utf-8")
    html = html.replace(
        '{"imports":{"three":"./node_modules/three/build/three.module.js","three/addons/":"./node_modules/three/examples/jsm/"}}',
        '{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/"}}',
    )
    (legacy / "index.html").write_text(html, encoding="utf-8")
    assets = legacy / "assets"
    assets.mkdir(exist_ok=True)
    for name in ("background.png", "subject.png", "text.png", "lineart.png", "card.glb"):
        shutil.copy2(ROOT / "cards" / "lebron-james-001" / "web" / "assets" / name, assets / name)


def main() -> None:
    (PUBLIC / "cards").mkdir(parents=True, exist_ok=True)
    players = []
    for p in PLAYERS:
        build_player(p)
        cfg = {k: v for k, v in p.items() if k != "subject"}
        cfg["assets"] = {
            "front": f"/cards/{p['id']}/front.webp",
            "thumb": f"/cards/{p['id']}/thumb.webp",
            "subject": f"/cards/{p['id']}/subject.webp",
            "background": f"/cards/{p['id']}/background.webp",
            "layers": {
                "subject": f"/cards/{p['id']}/layers/subject.png",
                "background": f"/cards/{p['id']}/layers/background.png",
                "lineart": f"/cards/{p['id']}/layers/lineart.png",
                "text": f"/cards/{p['id']}/layers/text.png",
            },
        }
        players.append(cfg)
    (PUBLIC / "cards" / "manifest.json").write_text(
        json.dumps({"version": 2, "players": players}, ensure_ascii=False, indent=2), encoding="utf-8")
    copy_legacy()
    print(f"manifest: {len(players)} players")


if __name__ == "__main__":
    main()
