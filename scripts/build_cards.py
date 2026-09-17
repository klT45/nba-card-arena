"""Build layered holographic card assets from the player library.

Single source of truth: ``cards/library/players.json`` plus each player's
``cards/library/<id>/cutout.png`` (alpha matte) and ``photo.jpg`` (the licensed
game photo the matte was cut from).

Every player is rendered as a *poster*: the game photo is graded into a team
colour backdrop, the matte is blown up to hero size, the subject is backlit and
the type is set in condensed display faces. The result is emitted as the four
equal-size layers the holo-card-studio shader expects - ``background``,
``subject`` (alpha), ``lineart`` and ``text`` - plus flat ``front``/``thumb``
composites, a per-card ``card.json`` and a skill-compatible
``card-config.json``.

Usage:
    python scripts/build_cards.py                 # all players
    python scripts/build_cards.py --only curry    # substring match on ids
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import zlib
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
import card_styles  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
LIBRARY = ROOT / "cards" / "library"
W, H = 1024, 1493
# Poster grid, as fractions of H.
HEADER_H = 0.082
PLATE_TOP = 0.792
SUBJECT_BOTTOM = 0.975
# A standing full-body matte is ~3:1; cropped to this ratio it reads as the
# three-quarter "hero" framing a collectible card actually uses, and the cut
# edge lands behind the name plate.
SUBJECT_MAX_AR = 1.9


# ------------------------------------------------------------- library ------
def load_library() -> dict:
    data = json.loads((LIBRARY / "players.json").read_text(encoding="utf-8"))
    players = data.get("players", [])
    ids = [p["id"] for p in players]
    if len(ids) != len(set(ids)):
        raise SystemExit("players.json has duplicate ids")
    return data


# ---------------------------------------------------------------- fonts -----
_DISPLAY = Path("C:/Windows/Fonts/bahnschrift.ttf")


def save_retry(image: Image.Image, path: Path, tries: int = 6, **kwargs) -> None:
    """Save with retries: a running dev server can briefly lock files on Windows."""
    import time
    last: Exception | None = None
    for attempt in range(tries):
        try:
            image.save(path, **kwargs)
            return
        except OSError as exc:
            last = exc
            time.sleep(0.4 * (attempt + 1))
    raise last  # type: ignore[misc]


def display_font(size: int, weight: str = "bold") -> ImageFont.FreeTypeFont:
    """Bahnschrift's condensed grades, for sports-poster headlines."""
    if _DISPLAY.exists():
        f = ImageFont.truetype(str(_DISPLAY), size)
        name = {"bold": "Bold Condensed", "semi": "SemiBold Condensed",
                "cond": "Condensed", "wide": "Bold"}.get(weight, "Bold Condensed")
        try:
            f.set_variation_by_name(name)
        except (OSError, ValueError):
            pass
        return f
    return font(size, bold=True)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    for name in (("arialbd.ttf", "calibrib.ttf") if bold else ("arial.ttf", "calibri.ttf")):
        path = Path("C:/Windows/Fonts") / name
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def fit_display(draw: ImageDraw.ImageDraw, text: str, max_w: int, size: int,
                weight: str = "bold", floor: int = 18) -> ImageFont.FreeTypeFont:
    while size > floor:
        f = display_font(size, weight)
        if draw.textlength(text, font=f) <= max_w:
            return f
        size -= 2
    return display_font(size, weight)


def tracked(draw: ImageDraw.ImageDraw, xy, text: str, fnt, fill, track: float = 0.0, anchor=None):
    """Draw text with letter-spacing (PIL has no tracking of its own)."""
    if not track:
        draw.text(xy, text, font=fnt, fill=fill, anchor=anchor)
        return
    if anchor and anchor[0] == "r":
        widths = [draw.textlength(c, font=fnt) for c in text]
        total = sum(widths) + track * (len(text) - 1)
        x = xy[0] - total
        for c, w in zip(text, widths):
            draw.text((x, xy[1]), c, font=fnt, fill=fill, anchor="l" + anchor[1])
            x += w + track
    else:
        x = xy[0]
        for c in text:
            draw.text((x, xy[1]), c, font=fnt, fill=fill, anchor="l" + (anchor[1] if anchor else "a"))
            x += draw.textlength(c, font=fnt) + track


# ------------------------------------------------------------- subject ------
def keep_subject(im: Image.Image, keep_ratio: float = 0.18):
    """Drop bystanders the segmentation model also picked up.

    Returns ``(cropped_rgba, normalized_bbox)`` where the bbox is expressed in
    fractions of the full matte, so callers can map it onto any crop of the
    original photo.
    """
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
    if not bbox:
        return out, None
    fw, fh = out.size
    norm = (bbox[0] / fw, bbox[1] / fh, (bbox[2] - bbox[0]) / fw, (bbox[3] - bbox[1]) / fh)
    return out.crop(bbox), norm


def load_subject(player: dict):
    path = LIBRARY / player["id"] / "cutout.png"
    if not path.exists():
        raise SystemExit(
            f"missing {path.relative_to(ROOT)} - upload a photo for '{player['id']}' "
            f"in /admin.html, or run: python scripts/make_cutout.py "
            f"cards/library/{player['id']}/photo.jpg cards/library/{player['id']}/cutout.png")
    return keep_subject(Image.open(path).convert("RGBA"))


def has_assets(player: dict) -> bool:
    """True once a matte exists for this player.

    A player added from /admin.html has no art until a photo is uploaded, and
    `load_subject` aborts the whole run for it. That used to mean one
    photo-less new player blocked every rebuild — including edits to unrelated
    cards. main() skips those instead of dying.
    """
    return (LIBRARY / player["id"] / "cutout.png").exists()


def place_subject(subject: Image.Image):
    """Hero-size the matte: crop to a three-quarter frame, then fill the card."""
    if subject.height / subject.width > SUBJECT_MAX_AR:
        subject = subject.crop((0, 0, subject.width, int(subject.width * SUBJECT_MAX_AR)))
    max_h, max_w = int(H * 0.93), int(W * 0.98)
    scale = min(max_h / subject.height, max_w / subject.width)
    nw, nh = max(1, int(subject.width * scale)), max(1, int(subject.height * scale))
    sub = subject.resize((nw, nh), Image.LANCZOS)
    return sub, ((W - nw) // 2, int(H * SUBJECT_BOTTOM) - nh)


def backlight(subject_layer: Image.Image, accent: tuple, strength: float = 1.35) -> Image.Image:
    """Team-colour bloom behind the subject so the cutout lifts off the photo."""
    solid = Image.new("RGBA", subject_layer.size, (*accent, 255))
    solid.putalpha(subject_layer.getchannel("A"))
    glow = solid.filter(ImageFilter.GaussianBlur(30))
    a = glow.getchannel("A").point(lambda v: min(255, int(v * strength)))
    glow.putalpha(a)
    return Image.alpha_composite(glow, subject_layer)


def contact_shadow(subject_layer: Image.Image) -> Image.Image:
    a = subject_layer.getchannel("A")
    shadow = Image.new("RGBA", subject_layer.size, (2, 4, 10, 255))
    shadow.putalpha(a.filter(ImageFilter.GaussianBlur(18)).point(lambda v: int(v * 0.75)))
    return shadow


# ------------------------------------------------------------ background ----
def cover_fit(src: Image.Image, size, centering=(0.5, 0.5)):
    """Cover-crop ``src`` to ``size``; also return the affine map photo->canvas."""
    cw, ch = size
    sw, sh = src.size
    scale = max(cw / sw, ch / sh)
    nw, nh = max(cw, int(round(sw * scale))), max(ch, int(round(sh * scale)))
    resized = src.resize((nw, nh), Image.LANCZOS)
    left = max(0, min(nw - cw, int(round((nw - cw) * centering[0]))))
    top = max(0, min(nh - ch, int(round((nh - ch) * centering[1]))))
    return resized.crop((left, top, left + cw, top + ch)), (scale, left, top)


def find_photo(player: dict) -> Path | None:
    for ext in ("jpg", "jpeg", "png", "webp"):
        p = LIBRARY / player["id"] / f"photo.{ext}"
        if p.exists():
            return p
    return None


def _duotone(lum: np.ndarray, dark, light) -> np.ndarray:
    """Map a 0..1 luminance field onto a two-colour ramp."""
    d = np.array(dark, np.float32) / 255.0
    l = np.array(light, np.float32) / 255.0
    return d[None, None, :] + (l - d)[None, None, :] * lum[..., None]


def _inpaint(rgb: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Fill the masked subject region from its surroundings, so the backdrop
    never shows a duplicate of the cutout or a rectangular patch seam."""
    h, w = mask.shape
    sw, sh = max(64, w // 3), max(64, h // 3)
    small = cv2.resize(rgb, (sw, sh), interpolation=cv2.INTER_AREA)
    m = cv2.resize(mask, (sw, sh), interpolation=cv2.INTER_NEAREST)
    m = cv2.dilate(cv2.threshold(m, 24, 255, cv2.THRESH_BINARY)[1], np.ones((5, 5), np.uint8), iterations=2)
    filled = cv2.inpaint(small, m, 15, cv2.INPAINT_TELEA)
    out = cv2.resize(filled, (w, h), interpolation=cv2.INTER_LINEAR)
    out = cv2.GaussianBlur(out, (0, 0), 6)
    a = (cv2.GaussianBlur(mask, (0, 0), 10).astype(np.float32) / 255.0)[..., None]
    return np.clip(out.astype(np.float32) * a + rgb.astype(np.float32) * (1 - a), 0, 255).astype(np.uint8)


def _halftone(size, color, spacing=15, radius=3.4, alpha=54, origin=(0, 0)):
    w, h = size
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer, "RGBA")
    for y in range(origin[1] % spacing, h, spacing):
        for x in range(origin[0] % spacing, w, spacing):
            d.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(*color, alpha))
    return layer


def _streaks(size, color, rng, count=26, alpha=30):
    w, h = size
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer, "RGBA")
    for _ in range(count):
        x = float(rng.integers(-int(w * 0.3), w))
        y = float(rng.integers(-int(h * 0.1), h))
        length = float(rng.integers(int(h * 0.2), int(h * 0.85)))
        width = float(rng.integers(2, 9))
        a = int(rng.integers(alpha // 3, alpha))
        d.polygon([(x, y), (x + width, y), (x + width + length * 0.34, y + length),
                   (x + length * 0.34, y + length)], fill=(*color, a))
    return layer.filter(ImageFilter.GaussianBlur(2.4))


def _rays(size, color, alpha=16, blur=28, count=9):
    w, h = size
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer, "RGBA")
    for i in range(-count, count + 1):
        x = w * 0.5 + i * w * 0.16
        d.polygon([(x, -h * 0.1), (x + w * 0.055, -h * 0.1),
                   (x - h * 0.26, h * 1.05), (x - h * 0.33, h * 1.05)],
                  fill=(*color, alpha))
    return layer.filter(ImageFilter.GaussianBlur(blur))


def _vignette(size, strength=0.72, power=2.1):
    w, h = size
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    u = (xs - w / 2) / (w / 2)
    v = (ys - h / 2) / (h / 2)
    r = np.sqrt(u * u + v * v) / 1.4142
    a = np.clip(r ** power, 0, 1) * strength
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    layer.putalpha(Image.fromarray((a * 255).astype(np.uint8), "L"))
    return layer


def build_background(player: dict, style_id: str, subject_norm, photo_size, size=(W, H)) -> Image.Image:
    """Grade the licensed game photo into a team-coloured poster backdrop."""
    cw, ch = size
    style = card_styles.STYLES.get(style_id) or card_styles.STYLES["arena"]
    accent = card_styles._hex(player["accent"])
    accent2 = card_styles._hex(player["accent2"])
    rng = np.random.default_rng(zlib.crc32(player["id"].encode()))

    photo_path = find_photo(player)
    base = None
    transform = None
    if photo_path:
        try:
            src = Image.open(photo_path).convert("RGB")
            # Bias the crop upward so heads stay out of the name plate.
            cy = 0.30
            if subject_norm:
                cy = float(np.clip(subject_norm[1] + subject_norm[3] * 0.35, 0.10, 0.60))
            base, transform = cover_fit(src, size, (0.5, cy))
            base = base.filter(ImageFilter.GaussianBlur(17))
        except (OSError, ValueError):
            base = None

    if base is None:
        base = Image.new("RGB", size, accent2)
        transform = None

    arr = np.asarray(base).astype(np.float32) / 255.0
    lum = (arr[..., 0] * 0.299 + arr[..., 1] * 0.587 + arr[..., 2] * 0.114)
    lum = np.clip((lum - 0.10) / 0.80, 0, 1) ** 1.12
    duo = _duotone(lum, [c * 0.16 for c in accent2], [min(255, c * 1.15) for c in accent])
    graded = duo * 0.86 + arr * 0.14
    graded *= 0.50  # keep the backdrop well under the subject

    bg = Image.fromarray((np.clip(graded, 0, 1) * 255).astype(np.uint8), "RGB").convert("RGBA")

    # Erase the ghost of the subject that the same photo would otherwise show.
    if transform and subject_norm:
        scale, left, top = transform
        pw, ph = photo_size
        bx, by, bw, bh = subject_norm
        mx0 = int(bx * pw * scale - left)
        my0 = int(by * ph * scale - top)
        mw = max(1, int(bw * pw * scale))
        mh = max(1, int(bh * ph * scale))
        patch = Image.new("L", (cw, ch), 0)
        patch.paste(Image.new("L", (mw, mh), 255), (mx0, my0))
        patch = patch.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.GaussianBlur(18))
        bg = Image.fromarray(_inpaint(np.asarray(bg.convert("RGB")), np.asarray(patch)), "RGB").convert("RGBA")

    # Style-specific graphics layered over the graded photo.
    if style_id == "ink":
        paper = Image.new("RGBA", size, (238, 231, 217, 168))
        bg = Image.alpha_composite(bg, paper)
        bg = Image.alpha_composite(bg, _halftone(size, (52, 50, 46), 13, 2.4, 26))
    elif style_id == "gold":
        bg = Image.alpha_composite(bg, _streaks(size, (255, 214, 130), rng, 34, 34))
        bg = Image.alpha_composite(bg, _rays(size, (255, 206, 92), 18, 30, 7))
    elif style_id == "prism":
        bg = Image.alpha_composite(bg, _rays(size, (255, 255, 255), 14, 24, 10))
        bg = Image.alpha_composite(bg, _halftone(size, (255, 255, 255), 17, 3.0, 30))
    elif style_id == "atelier":
        bg = Image.alpha_composite(bg, _streaks(size, (244, 208, 135), rng, 18, 22))
    else:  # arena
        bg = Image.alpha_composite(bg, _streaks(size, accent, rng, 30, 32))
        bg = Image.alpha_composite(bg, _rays(size, accent, 15, 30, 8))

    # Spotlight behind the subject, then the poster furniture.
    glow = Image.new("RGBA", size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow, "RGBA")
    gd.ellipse((-cw * 0.20, -ch * 0.04, cw * 1.20, ch * 0.86), fill=(*accent, 62))
    bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(150)))

    bg = Image.alpha_composite(bg, _vignette(size, 0.80, 2.0))

    d = ImageDraw.Draw(bg, "RGBA")
    # Oversized jersey number as a translucent outline watermark in the background.
    num = str(player["number"])
    nf = display_font(int(ch * 0.235), "bold")
    d.text((cw - 52, int(ch * 0.100)), num, font=nf, anchor="ra", fill=(*accent, 54),
           stroke_width=3, stroke_fill=(*accent, 116))
    tf = display_font(int(ch * 0.046), "bold")
    tracked(d, (cw - 56, int(ch * 0.330)), player["teamShort"], tf, (*accent, 130), track=6, anchor="ra")
    return bg


# ---------------------------------------------------------------- text ------
def build_text(player: dict, style_id: str, palette: dict) -> Image.Image:
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer, "RGBA")
    primary, accent, muted = palette["primary"], palette["accent"], palette["muted"]
    pad = 54

    # 1. 顶部 Header 栏物理装裱层（固定在卡牌表面，避免 3D 视差错位）
    hh = int(H * HEADER_H)
    d.rectangle((0, 0, W, hh), fill=(6, 8, 14, 235))
    d.line((0, hh, W, hh), fill=(*accent, 220), width=3)
    d.rectangle((0, hh, int(W * 0.22), hh + 5), fill=(*accent, 255))

    hf = display_font(int(H * 0.032), "semi")
    tracked(d, (pad, int(H * HEADER_H * 0.52)), player["team"].upper(), hf, (*accent, 255),
            track=2.6, anchor="lm")
    tracked(d, (W - pad, int(H * HEADER_H * 0.52)), " / ".join(player["positions"]), hf,
            (*primary, 240), track=2.6, anchor="rm")

    # 2. 底部 Bottom Plate 铭牌面板（固定在卡牌表面，牢固托载球员姓名与号码）
    pt = int(H * PLATE_TOP)
    d.rectangle((0, pt, W, H), fill=(4, 6, 12, 242))
    d.line((0, pt, W, pt), fill=(*accent, 255), width=5)
    d.rectangle((0, pt, 14, H), fill=(*accent, 255))
    d.line((0, pt + int(H * 0.004), W, pt + int(H * 0.004)), fill=(255, 255, 255, 45), width=2)

    inner = pad + 24
    num_text = f"No.{player['number']}"
    num_font = display_font(int(H * 0.050), "bold")
    num_w = int(d.textlength(num_text, font=num_font)) + 26

    rf = display_font(int(H * 0.023), "semi")
    tracked(d, (inner, pt + int(H * 0.026)), player["rarity"], rf, (*accent, 255), track=4.2, anchor="lm")

    name_font = fit_display(d, player["name"].upper(), W - inner - pad - num_w, int(H * 0.064), "bold")
    d.text((inner, pt + int(H * 0.062)), player["name"].upper(), font=name_font, fill=(*primary, 255))
    d.text((W - pad, pt + int(H * 0.088)), num_text, font=num_font, anchor="rm", fill=(*accent, 255))

    tf = display_font(int(H * 0.025), "cond")
    tracked(d, (inner, pt + int(H * 0.150)), player["title"], tf, (*muted, 255), track=3.2, anchor="lm")
    return layer


# ------------------------------------------------------------- lineart ------
def build_lineart(subject_layer: Image.Image, style_id: str) -> Image.Image:
    alpha = np.asarray(subject_layer)[..., 3]
    edges = cv2.Canny(alpha, 50, 150)
    it = 2 if style_id == "ink" else 1
    edges = cv2.dilate(edges, np.ones((2, 2), np.uint8), iterations=it)
    line = np.full((H, W), 255, np.uint8)
    line[edges > 0] = 0
    return Image.fromarray(cv2.GaussianBlur(line, (3, 3), 0), "L")


# ---------------------------------------------------------------- foil ------
def _value_noise(rng: np.random.Generator, cells: int) -> np.ndarray:
    small = rng.random((max(2, H // cells), max(2, W // cells))).astype(np.float32)
    im = Image.fromarray((small * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)
    return np.asarray(im).astype(np.float32) / 255.0


def bake_foil(base: Image.Image, seed: int, intensity: float) -> Image.Image:
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
    k = min(0.30, 0.10 + intensity * 0.20)
    out = b * (1 - k) + overlay * k
    sweep = np.power(np.clip(np.sin((u * 0.83 + v * 0.35) * 6.283), 0, None), 12)
    out = out + foil * sweep[..., None] * (0.08 + intensity * 0.10)
    sparkle = np.where(_value_noise(rng, 6) > 0.9975, 1.0, 0.0)
    out = np.clip(out + sparkle[..., None] * (0.18 + intensity * 0.3), 0, 1)
    return Image.fromarray((out * 255).astype(np.uint8), "RGB")


# --------------------------------------------------------------- build ------
def build_player(player: dict) -> dict:
    style_id = player.get("style") or "arena"
    params = card_styles.params(style_id)
    palette = card_styles.text_palette(style_id, player["accent"])
    out = PUBLIC / "cards" / player["id"]
    (out / "layers").mkdir(parents=True, exist_ok=True)

    photo_path = find_photo(player)
    photo_size = Image.open(photo_path).size if photo_path else (W, H)

    subject, norm = load_subject(player)
    sub, pos = place_subject(subject)
    subject_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    subject_layer.alpha_composite(sub, pos)
    subject_layer = Image.alpha_composite(contact_shadow(subject_layer), subject_layer)
    accent = card_styles._hex(player["accent"])
    subject_layer = backlight(subject_layer, accent)

    background = build_background(player, style_id, norm, photo_size)
    text = build_text(player, style_id, palette)
    lineart = build_lineart(subject_layer, style_id)

    flat = Image.alpha_composite(background, subject_layer).convert("RGB")
    flat = bake_foil(flat, zlib.crc32(player["id"].encode()), params["foil"])
    flat = Image.alpha_composite(flat.convert("RGBA"), text)
    flat = ImageEnhance.Contrast(flat.convert("RGB")).enhance(1.04)
    save_retry(flat, out / "front.webp", format="WEBP", quality=90, method=6)
    thumb = flat.copy()
    thumb.thumbnail((460, 670), Image.LANCZOS)
    save_retry(thumb, out / "thumb.webp", format="WEBP", quality=82, method=6)

    save_retry(background, out / "layers" / "background.png", format="PNG", optimize=True)
    save_retry(subject_layer, out / "layers" / "subject.png", format="PNG", optimize=True)
    save_retry(lineart, out / "layers" / "lineart.png", format="PNG", optimize=True)
    save_retry(text, out / "layers" / "text.png", format="PNG", optimize=True)

    assets = {
        "front": f"/cards/{player['id']}/front.webp",
        "thumb": f"/cards/{player['id']}/thumb.webp",
        "layers": {
            "subject": f"/cards/{player['id']}/layers/subject.png",
            "background": f"/cards/{player['id']}/layers/background.png",
            "lineart": f"/cards/{player['id']}/layers/lineart.png",
            "text": f"/cards/{player['id']}/layers/text.png",
        },
    }
    card = {**player, "parameters": params, "assets": assets}
    (out / "card.json").write_text(json.dumps(card, ensure_ascii=False, indent=2), encoding="utf-8")
    # skill-compatible per-card config
    (out / "card-config.json").write_text(json.dumps({
        "mode": "holographic",
        "style": style_id,
        "title": player["name"],
        "subtitle": player["title"],
        "collection": "CARD ARENA",
        "edition": f"No.{player['number']}",
        "description": f"{player['team']} · {' / '.join(player['positions'])}",
        "assets": {k: v for k, v in assets["layers"].items()} | {"model": ""},
        "parameters": params,
        "safeArea": {"scale": 1.0, "offset": [0, 0]},
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    return card


def copy_legacy() -> None:
    src = ROOT / "cards" / "lebron-james-001" / "web"
    if not src.exists():
        return
    legacy = PUBLIC / "legacy" / "lebron"
    legacy.mkdir(parents=True, exist_ok=True)
    for name in ("index.html", "style.css", "app.js", "card-config.json"):
        shutil.copy2(src / name, legacy / name)
    html = (legacy / "index.html").read_text(encoding="utf-8")
    html = html.replace(
        '{"imports":{"three":"./node_modules/three/build/three.module.js","three/addons/":"./node_modules/three/examples/jsm/"}}',
        '{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/"}}',
    )
    (legacy / "index.html").write_text(html, encoding="utf-8")
    assets = legacy / "assets"
    assets.mkdir(exist_ok=True)
    for name in ("background.png", "subject.png", "text.png", "lineart.png", "card.glb"):
        f = src / "assets" / name
        if f.exists():
            shutil.copy2(f, assets / name)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated id substrings to rebuild")
    args = ap.parse_args()
    lib = load_library()
    only = [s.strip() for s in args.only.split(",")] if args.only else None
    players = [p for p in lib["players"] if not only or any(o in p["id"] for o in only)]
    if not players:
        raise SystemExit(f"no players matched --only {args.only}")

    cards = {}
    skipped: list[str] = []
    # Preserve untouched players' existing card.json so the manifest stays complete.
    for p in lib["players"]:
        f = PUBLIC / "cards" / p["id"] / "card.json"
        if f.exists():
            try:
                cards[p["id"]] = json.loads(f.read_text(encoding="utf-8"))
            except Exception:  # noqa: BLE001
                pass
    failed: list[tuple[str, str]] = []
    for p in players:
        if not has_assets(p):
            skipped.append(p["id"])
            continue
        # One broken record must not take the whole run down. `has_assets()`
        # already covers a missing matte, but a record with a missing or
        # malformed FIELD (a hand-edited players.json, an accent that is not a
        # colour) raises from build_player, and manifest.json is written only
        # after this loop - so letting it escape left every other player in the
        # batch unpublished, and on a fresh checkout no manifest at all.
        try:
            cards[p["id"]] = build_player(p)
        except Exception as exc:  # noqa: BLE001
            failed.append((p["id"], f"{type(exc).__name__}: {exc}"))
            continue
        print("built", p["id"], f"[{p.get('style', 'arena')}]")
    for pid in skipped:
        print(f"skipped {pid} - no cutout yet; upload a photo for it in /admin.html")
    for pid, why in failed:
        print(f"FAILED {pid} - {why}")
    ordered = [cards[p["id"]] for p in lib["players"] if p["id"] in cards]
    (PUBLIC / "cards" / "manifest.json").write_text(json.dumps({
        "version": 3,
        "styles": card_styles.style_list(),
        "players": ordered,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    copy_legacy()
    print(f"manifest: {len(ordered)} players"
          + (f" ({len(skipped)} skipped, no art yet)" if skipped else "")
          + (f" ({len(failed)} FAILED)" if failed else ""))
    # The manifest is on disk either way, so a partial run still publishes
    # everyone else. Exit non-zero only to tell the caller something broke -
    # the admin API turns that into `ok: false`, which is how a bad accent on a
    # single card stops being reported as "已重建".
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
