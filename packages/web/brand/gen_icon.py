"""Render the tablo 't.' AppIcon from the real Doto Black font.
Ports components/brand/AppIcon.jsx geometry. Master is FULL-BLEED (no rounded
corners) — iOS/Android/PWA apply their own mask."""
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
    fs = round(size * 0.6)
    sq = round(fs * 0.16)
    font = ImageFont.truetype(FONT, fs)
    # left-baseline INK box of the "t" (advance has wide trailing sidebearing
    # in this monospace face — position off the ink so "t." reads tight)
    x0, y0, x1, y1 = draw.textbbox((0, 0), "t", font=font, anchor="ls")
    gap = round(sq * 0.6)  # ~1 letter-dot between the t's ink and the stop
    block_w = (x1 - x0) + gap + sq
    pen = (size - block_w) / 2.0 - x0
    # vertically centre the "t" ink, then nudge up by 0.035*size (the JS translateY)
    baseline = (size - (y0 + y1)) / 2.0 - round(size * 0.035)
    sx = pen + x1 + gap
    sy = baseline - sq
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
# served sizes → public/ (Vite copies these to the site root)
for px, name in [(512, "icon-512.png"), (192, "icon-192.png"),
                 (180, "apple-touch-icon.png"), (32, "favicon-32.png"),
                 (16, "favicon-16.png")]:
    master.resize((px, px), Image.LANCZOS).save(os.path.join(PUBLIC, name))
print("written master + 5 served sizes")
