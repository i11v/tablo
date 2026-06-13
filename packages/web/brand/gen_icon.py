"""Render the tablo 't.' AppIcon from the real Doto Black font.
Ports the `bleed` branch of components/brand/AppIcon.jsx geometry: the "t" is
blown up to own the whole tile (no breathing margin — the old 0.6x glyph read
as a padded icon on the Home Screen) with the green make-square anchored
low-right. Master is FULL-BLEED (no rounded corners) — iOS/Android/PWA apply
their own mask."""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(HERE, "Doto-Black.ttf")  # see README.md for the source URL
INK = (236, 234, 227)   # --color-ink  #eceae3
MAKE = (34, 224, 107)   # --color-make #22e06b
C_TOP = (0x17, 0x17, 0x1d)
C_BOT = (0x08, 0x08, 0x0a)

def board(size):
    # radial-gradient(125% 95% at 50% 0%, #17171d, #08080a 70%)
    y, x = np.mgrid[0:size, 0:size].astype(np.float64)
    cx, cy = size / 2.0, 0.0
    rx, ry = 1.25 * size, 0.95 * size
    d = np.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2)
    t = np.clip(d / 0.70, 0.0, 1.0)[..., None]
    top = np.array(C_TOP, float); bot = np.array(C_BOT, float)
    rgb = (top * (1 - t) + bot * t).astype(np.uint8)
    a = np.full((size, size, 1), 255, np.uint8)
    return Image.fromarray(np.concatenate([rgb, a], axis=2), "RGBA")

def render(size):
    img = board(size)
    draw = ImageDraw.Draw(img)
    fs = round(size * 1.22)  # full-bleed glyph — the "t" owns the whole tile
    sq = round(fs * 0.16)
    font = ImageFont.truetype(FONT, fs)
    # Mirror the bleed branch's CSS box model: the "t" span is centred in the
    # tile by `flex items-center justify-center` (advance + line box, not ink),
    # then shoved DOWN by translateY(0.05*size) so the space above/below the
    # glyph balances. Monospace centring lands the heavy stem visually centred.
    asc, desc = font.getmetrics()
    pen = (size - font.getlength("t")) / 2.0                  # justify-center
    baseline = size / 2.0 + (asc - desc) / 2.0 + round(size * 0.05)  # items-center + nudge
    # green make-square — anchored low-right (the absolute right/bottom insets
    # of the bleed branch), independent of the glyph.
    sx = size - round(size * 0.16) - sq
    sy = size - round(size * 0.18) - sq
    # green full-stop glow — faithful CSS box-shadow: 0 0 (sq*1.1) make@70%
    # (shadow = the square's shape, gaussian sigma = blur_radius / 2)
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(glow).rectangle([sx, sy, sx + sq, sy + sq], fill=MAKE + (179,))
    glow = glow.filter(ImageFilter.GaussianBlur(sq * 1.1 / 2.0))
    img = Image.alpha_composite(img, glow)
    draw = ImageDraw.Draw(img)
    # the "t" glyph
    draw.text((pen, baseline), "t", font=font, fill=INK + (255,), anchor="ls")
    # the crisp green square
    draw.rectangle([sx, sy, sx + sq, sy + sq], fill=MAKE + (255,))
    return img

PUBLIC = os.path.normpath(os.path.join(HERE, "..", "public"))
os.makedirs(PUBLIC, exist_ok=True)
master = render(1024)
master.save(os.path.join(HERE, "icon-1024.png"))  # full-bleed master (reference)
# public/icon.png is the PWA generator source (pwa-assets.config.ts) — vite-plugin-pwa
# derives the favicon / apple-touch / manifest icon set from it at build.
master.save(os.path.join(PUBLIC, "icon.png"))
print("written brand/icon-1024.png + public/icon.png (PWA source)")
