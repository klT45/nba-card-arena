"""Build lightweight static card assets from prepared player cutouts."""
from __future__ import annotations

import json
import math
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
SOURCE = ROOT / "cards" / "_source" / "cutouts"
W, H = 768, 1120

PLAYERS = [
    {
        "id": "lebron-james",
        "name": "LeBron James",
        "number": "23",
        "team": "Los Angeles",
        "teamShort": "LAL",
        "positions": ["PG", "SF"],
        "positionsZh": ["控卫", "小前锋"],
        "rarity": "MYTHIC",
        "rating": 98,
        "accent": "#f6c547",
        "accent2": "#6c2bd9",
        "title": "THE CHOSEN ONE",
        "stats": {"finishing": 99, "shooting": 91, "playmaking": 97, "defense": 92},
        "source": "existing",
        "sourceUrl": "https://pngdownload.io/png-image/lebron-james-in-lakers-jersey-nba-superstar-transparent-png-image/",
        "sourceCredit": "PNGDownload.io, CC BY-NC 4.0",
    },
    {
        "id": "stephen-curry",
        "name": "Stephen Curry",
        "number": "30",
        "team": "Golden State",
        "teamShort": "GSW",
        "positions": ["PG"],
        "positionsZh": ["控卫"],
        "rarity": "MYTHIC",
        "rating": 97,
        "accent": "#ffc72c",
        "accent2": "#1d428a",
        "title": "THE CHEF",
        "stats": {"finishing": 91, "shooting": 99, "playmaking": 96, "defense": 82},
        "source": "curry_cut.png",
        "sourceUrl": "https://commons.wikimedia.org/wiki/File:Steph_Curry_(51913998322).jpg",
        "sourceCredit": "Erik Drost / Wikimedia Commons, CC BY 2.0",
    },
    {
        "id": "devin-booker",
        "name": "Devin Booker",
        "number": "01",
        "team": "Phoenix",
        "teamShort": "PHX",
        "positions": ["SG", "PG"],
        "positionsZh": ["分卫", "控卫"],
        "rarity": "ELITE",
        "rating": 94,
        "accent": "#ffb81c",
        "accent2": "#5f259f",
        "title": "DESERT SNIPER",
        "stats": {"finishing": 92, "shooting": 96, "playmaking": 90, "defense": 84},
        "source": "booker_cut.png",
        "sourceUrl": "https://commons.wikimedia.org/wiki/File:Booker_and_Curry,_Paris_2024_Olympic_Games.jpg",
        "sourceCredit": "Clement Bardot / Wikimedia Commons, CC BY-SA 4.0",
    },
    {
        "id": "kevin-durant",
        "name": "Kevin Durant",
        "number": "35",
        "team": "Phoenix",
        "teamShort": "PHX",
        "positions": ["SF", "PF"],
        "positionsZh": ["小前锋", "大前锋"],
        "rarity": "MYTHIC",
        "rating": 97,
        "accent": "#ff6a13",
        "accent2": "#28155e",
        "title": "SLIM REAPER",
        "stats": {"finishing": 96, "shooting": 98, "playmaking": 91, "defense": 89},
        "source": "durant_cut.png",
        "sourceUrl": "https://commons.wikimedia.org/wiki/File:Kevin_Durant,_Olympic_Games_2024.jpg",
        "sourceCredit": "Clement Bardot / Wikimedia Commons, CC BY-SA 4.0",
    },
    {
        "id": "giannis-antetokounmpo",
        "name": "Giannis Antetokounmpo",
        "number": "34",
        "team": "Milwaukee",
        "teamShort": "MIL",
        "positions": ["PF", "C"],
        "positionsZh": ["大前锋", "中锋"],
        "rarity": "MYTHIC",
        "rating": 97,
        "accent": "#eee1c6",
        "accent2": "#00471b",
        "title": "GREEK FREAK",
        "stats": {"finishing": 99, "shooting": 84, "playmaking": 91, "defense": 97},
        "source": "giannis_cut.png",
        "cleanup": False,
        "sourceUrl": "https://commons.wikimedia.org/wiki/File:Giannis_Antetokounmpo_(51915070867).jpg",
        "sourceCredit": "Erik Drost / Wikimedia Commons, CC BY 2.0",
    },
    {
        "id": "nikola-jokic",
        "name": "Nikola Jokic",
        "number": "15",
        "team": "Denver",
        "teamShort": "DEN",
        "positions": ["C"],
        "positionsZh": ["中锋"],
        "rarity": "MYTHIC",
        "rating": 98,
        "accent": "#fec524",
        "accent2": "#0e2240",
        "title": "THE JOKER",
        "stats": {"finishing": 96, "shooting": 92, "playmaking": 99, "defense": 90},
        "source": "jokic_cut.png",
        "sourceUrl": "https://commons.wikimedia.org/wiki/File:Nikola_Jokic_(51914124577).jpg",
        "sourceCredit": "Erik Drost / Wikimedia Commons, CC BY 2.0",
    },
]


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        Path("C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf"),
        Path("C:/Windows/Fonts/calibrib.ttf" if bold else "C:/Windows/Fonts/calibri.ttf"),
    ]
    path = next((p for p in candidates if p.exists()), None)
    if not path:
        return ImageFont.load_default()
    return ImageFont.truetype(str(path), size)


def hex_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def build_background(player: dict) -> Image.Image:
    a = hex_rgb(player["accent"])
    b = hex_rgb(player["accent2"])
    im = Image.new("RGBA", (W, H), (*b, 255))
    d = ImageDraw.Draw(im, "RGBA")
    for y in range(H):
        t = y / H
        color = tuple(int(b[i] * (1 - t * 0.55) + a[i] * t * 0.28) for i in range(3))
        d.line((0, y, W, y), fill=(*color, 255))
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow, "RGBA")
    gd.ellipse((-180, 180, W + 180, H + 280), outline=(*a, 110), width=34)
    gd.ellipse((-80, 280, W + 80, H + 130), outline=(255, 255, 255, 45), width=4)
    for x in range(-H, W + H, 52):
        gd.line((x, 0, x - H // 3, H), fill=(255, 255, 255, 12), width=12)
    glow = glow.filter(ImageFilter.GaussianBlur(10))
    im = Image.alpha_composite(im, glow)
    d = ImageDraw.Draw(im, "RGBA")
    for i in range(18):
        angle = i / 18 * math.tau
        cx = W // 2 + int(math.cos(angle) * 315)
        cy = 610 + int(math.sin(angle) * 470)
        d.ellipse((cx - 2, cy - 2, cx + 2, cy + 2), fill=(*a, 130))
    d.text((W - 42, 104), player["teamShort"], font=font(104, True), anchor="ra", fill=(255, 255, 255, 22))
    d.text((W - 38, 222), player["number"], font=font(184, True), anchor="ra", fill=(*a, 30))
    return im


def clean_subject(im: Image.Image, keep_ratio: float = 0.25, soft_lo: int = 32, soft_hi: int = 180) -> Image.Image:
    """Drop disconnected fragments that belong to the background/other players.

    Several sourced cutouts contain a second, larger-than-noise blob (a bystander
    or an object from the original photo) that is not connected to the player.
    Keep only components at least ``keep_ratio`` of the largest one and tighten
    the matte so faint haze around the subject does not ghost onto the card.
    """
    try:
        import numpy as np
        from scipy import ndimage
    except Exception:
        return im
    rgba = np.array(im.convert("RGBA"))
    alpha = rgba[..., 3]
    mask = alpha > 64
    if not mask.any():
        return im
    labels, count = ndimage.label(mask)
    if count > 1:
        sizes = ndimage.sum(mask, labels, range(1, count + 1))
        largest = sizes.max()
        keep = np.isin(labels, [i + 1 for i, size in enumerate(sizes) if size >= largest * keep_ratio])
        rgba[..., 3] = np.where(keep, alpha, 0)
        alpha = rgba[..., 3]
    rgba[..., 3] = np.clip((alpha.astype(np.float32) - soft_lo) / (soft_hi - soft_lo) * 255.0, 0, 255)
    out = Image.fromarray(rgba, "RGBA")
    bbox = out.getchannel("A").getbbox()
    return out.crop(bbox) if bbox else out


def fit_subject(subject: Image.Image, max_w: int = 650, max_h: int = 840) -> Image.Image:
    scale = min(max_w / subject.width, max_h / subject.height)
    return subject.resize((max(1, int(subject.width * scale)), max(1, int(subject.height * scale))), Image.Resampling.LANCZOS)


def build_front(player: dict, background: Image.Image, subject: Image.Image) -> Image.Image:
    im = background.copy()
    subject = fit_subject(subject)
    x = (W - subject.width) // 2
    y = 190 + max(0, 810 - subject.height)
    shadow = Image.new("RGBA", subject.size, (0, 0, 0, 0))
    shadow.putalpha(subject.getchannel("A").filter(ImageFilter.GaussianBlur(18)).point(lambda v: int(v * 0.65)))
    im.alpha_composite(shadow, (x + 15, y + 25))
    im.alpha_composite(subject, (x, y))
    d = ImageDraw.Draw(im, "RGBA")
    accent = (*hex_rgb(player["accent"]), 255)
    d.rounded_rectangle((16, 16, W - 16, H - 16), radius=35, outline=accent, width=9)
    d.rounded_rectangle((30, 30, W - 30, H - 30), radius=27, outline=(255, 255, 255, 115), width=2)
    d.rectangle((38, 38, W - 38, 125), fill=(7, 10, 19, 170))
    d.text((55, 78), player["team"].upper(), font=font(23, True), anchor="lm", fill=accent)
    positions = " / ".join(player["positions"])
    d.text((W - 55, 78), positions, font=font(26, True), anchor="rm", fill=(255, 255, 255, 245))
    d.rounded_rectangle((38, H - 210, W - 38, H - 38), radius=18, fill=(7, 10, 19, 215), outline=accent, width=2)
    d.text((58, H - 182), player["rarity"], font=font(18, True), fill=accent)
    d.text((58, H - 145), player["name"].upper(), font=font(49, True), fill=(255, 255, 255, 255))
    d.text((58, H - 79), player["title"], font=font(21, True), fill=(216, 221, 230, 255))
    d.text((W - 60, H - 126), str(player["rating"]), font=font(76, True), anchor="rm", fill=accent)
    return im


def build_player(player: dict) -> None:
    out = PUBLIC / "cards" / player["id"]
    out.mkdir(parents=True, exist_ok=True)
    if player["source"] == "existing":
        subject = Image.open(ROOT / "cards" / "lebron-james-001" / "assets" / "subject.png").convert("RGBA")
        bbox = subject.getchannel("A").getbbox()
        subject = subject.crop(bbox) if bbox else subject
    else:
        subject = Image.open(SOURCE / player["source"]).convert("RGBA")
        if player.get("cleanup", True):
            subject = clean_subject(subject)
    background = build_background(player)
    front = build_front(player, background, subject)
    background.save(out / "background.webp", "WEBP", quality=84, method=6)
    subject.save(out / "subject.webp", "WEBP", quality=88, method=6)
    front.save(out / "front.webp", "WEBP", quality=88, method=6)
    thumb = front.copy()
    thumb.thumbnail((330, 480), Image.Resampling.LANCZOS)
    thumb.save(out / "thumb.webp", "WEBP", quality=78, method=6)
    cfg = {k: v for k, v in player.items() if k not in ("source", "cleanup")}
    cfg["assets"] = {
        "front": f"/cards/{player['id']}/front.webp",
        "thumb": f"/cards/{player['id']}/thumb.webp",
        "subject": f"/cards/{player['id']}/subject.webp",
        "background": f"/cards/{player['id']}/background.webp",
    }
    (out / "card.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    print("built", player["id"])


def main() -> None:
    (PUBLIC / "cards").mkdir(parents=True, exist_ok=True)
    for player in PLAYERS:
        build_player(player)
    manifest = [{k: v for k, v in player.items() if k not in ("source", "cleanup")} for player in PLAYERS]
    for player in manifest:
        player["assets"] = {
            "front": f"/cards/{player['id']}/front.webp",
            "thumb": f"/cards/{player['id']}/thumb.webp",
            "subject": f"/cards/{player['id']}/subject.webp",
            "background": f"/cards/{player['id']}/background.webp",
        }
    (PUBLIC / "cards" / "manifest.json").write_text(
        json.dumps({"version": 1, "players": manifest}, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    # Keep the original Blender/Three card reachable from the static tree without duplicating node_modules.
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
    legacy_assets = legacy / "assets"
    legacy_assets.mkdir(exist_ok=True)
    for name in ("background.png", "subject.png", "text.png", "lineart.png", "card.glb"):
        shutil.copy2(ROOT / "cards" / "lebron-james-001" / "web" / "assets" / name, legacy_assets / name)


if __name__ == "__main__":
    main()
