"""Build layered holographic card assets from the player library.

Single source of truth: ``cards/library/players.json`` plus each player's
``cards/library/<id>/cutout.png`` (alpha matte) and optional ``photo.jpg``.
For every player this emits the four equal-size layers the holo-card-studio
shader expects - ``background``, ``subject`` (alpha), ``lineart`` and ``text`` -
plus flat ``front``/``thumb`` composites, a per-card ``card.json`` and a
skill-compatible ``card-config.json``.

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
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
import card_styles  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
LIBRARY = ROOT / "cards" / "library"
W, H = 1024, 1493
PANEL_TOP = int(H * 0.80)


# ------------------------------------------------------------- library ------
def load_library() -> dict:
    data = json.loads((LIBRARY / "players.json").read_text(encoding="utf-8"))
    players = data.get("players", [])
    ids = [p["id"] for p in players]
    if len(ids) != len(set(ids)):
        raise SystemExit("players.json has duplicate ids")
    return data


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


# ------------------------------------------------------------- subject ------
def keep_subject(im: Image.Image, keep_ratio: float = 0.25) -> Image.Image:
    """Drop bystanders the segmentation model also picked up."""
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


def load_subject(player: dict) -> Image.Image:
    path = LIBRARY / player["id"] / "cutout.png"
    if not path.exists():
        raise SystemExit(
            f"missing {path.relative_to(ROOT)} - upload a photo for '{player['id']}' "
            f"in /admin.html, or run: python scripts/make_cutout.py cards/library/{player['id']}/photo.jpg cards/library/{player['id']}/cutout.png")
    return keep_subject(Image.open(path).convert("RGBA"))


def place_subject(subject: Image.Image) -> tuple[Image.Image, tuple[int, int]]:
    max_h, max_w = int(H * 0.80), int(W * 0.86)
    scale = min(max_h / subject.height, max_w / subject.width)
    nw, nh = max(1, int(subject.width * scale)), max(1, int(subject.height * scale))
    sub = subject.resize((nw, nh), Image.LANCZOS)
    return sub, ((W - nw) // 2, int(H * 0.985) - nh)


# ---------------------------------------------------------------- text ------
def build_text(player: dict, style_id: str, palette: dict) -> Image.Image:
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer, "RGBA")
    primary, accent, muted = palette["primary"], palette["accent"], palette["muted"]
    pad = 62
    d.text((pad, int(H * 0.043)), player["team"].upper(), font=font(int(H * 0.030), True),
           anchor="lm", fill=(*accent, 255))
    d.text((W - pad, int(H * 0.043)), " / ".join(player["positions"]), font=font(int(H * 0.032), True),
           anchor="rm", fill=(*primary, 245))
    panel_pad = 34
    num_text = f"No.{player['number']}"
    num_font = font(int(H * 0.052), True)
    num_w = int(d.textlength(num_text, font=num_font)) + 24
    name_font = fit_font(d, player["name"].upper(), W - 2 * pad - panel_pad - num_w, int(H * 0.058))
    d.text((pad + panel_pad, PANEL_TOP + int(H * 0.048)), player["rarity"], font=font(int(H * 0.024), True),
           fill=(*accent, 255))
    d.text((pad + panel_pad, PANEL_TOP + int(H * 0.092)), player["name"].upper(), font=name_font,
           fill=(*primary, 255))
    d.text((pad + panel_pad, PANEL_TOP + int(H * 0.160)), player["title"], font=font(int(H * 0.026), True),
           fill=(*muted, 255))
    d.text((W - pad - panel_pad, PANEL_TOP + int(H * 0.126)), num_text, font=num_font,
           anchor="rm", fill=(*accent, 255))
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
    k = min(0.42, 0.14 + intensity * 0.26)
    out = b * (1 - k) + overlay * k
    sweep = np.power(np.clip(np.sin((u * 0.83 + v * 0.35) * 6.283), 0, None), 12)
    out = out + foil * sweep[..., None] * (0.10 + intensity * 0.12)
    sparkle = np.where(_value_noise(rng, 6) > 0.986, 1.0, 0.0)
    out = np.clip(out + sparkle[..., None] * (0.25 + intensity * 0.4), 0, 1)
    return Image.fromarray((out * 255).astype(np.uint8), "RGB")


# --------------------------------------------------------------- build ------
def build_player(player: dict) -> dict:
    style_id = player.get("style") or "arena"
    params = card_styles.params(style_id)
    palette = card_styles.text_palette(style_id, player["accent"])
    out = PUBLIC / "cards" / player["id"]
    (out / "layers").mkdir(parents=True, exist_ok=True)

    subject = load_subject(player)
    sub, pos = place_subject(subject)
    subject_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    subject_layer.alpha_composite(sub, pos)
    background = card_styles.render_background(player, style_id, (pos[0], pos[1], sub.width, sub.height), (W, H), font)
    text = build_text(player, style_id, palette)
    lineart = build_lineart(subject_layer, style_id)

    flat = Image.alpha_composite(background, subject_layer).convert("RGB")
    flat = bake_foil(flat, zlib.crc32(player["id"].encode()), params["foil"])
    flat = Image.alpha_composite(flat.convert("RGBA"), text)
    flat.convert("RGB").save(out / "front.webp", "WEBP", quality=88, method=6)
    thumb = flat.convert("RGB").copy()
    thumb.thumbnail((430, 626), Image.LANCZOS)
    thumb.save(out / "thumb.webp", "WEBP", quality=80, method=6)

    background.save(out / "layers" / "background.png", optimize=True)
    subject_layer.save(out / "layers" / "subject.png", optimize=True)
    lineart.save(out / "layers" / "lineart.png", optimize=True)
    text.save(out / "layers" / "text.png", optimize=True)

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
    # Preserve untouched players' existing card.json so the manifest stays complete.
    for p in lib["players"]:
        f = PUBLIC / "cards" / p["id"] / "card.json"
        if f.exists():
            try:
                cards[p["id"]] = json.loads(f.read_text(encoding="utf-8"))
            except Exception:  # noqa: BLE001
                pass
    for p in players:
        cards[p["id"]] = build_player(p)
        print("built", p["id"], f"[{p.get('style', 'arena')}]")
    ordered = [cards[p["id"]] for p in lib["players"] if p["id"] in cards]
    (PUBLIC / "cards" / "manifest.json").write_text(json.dumps({
        "version": 3,
        "styles": card_styles.style_list(),
        "players": ordered,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    copy_legacy()
    print(f"manifest: {len(ordered)} players")


if __name__ == "__main__":
    main()
