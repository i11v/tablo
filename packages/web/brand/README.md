# tablo brand assets — the `t.` app icon

The product icon is the wordmark reduced to its initial: a Doto **`t`** + the
green **full-stop square** that doubles as the live-connection signal, on the
warm board ground. Geometry ports `tablo-design-system/components/brand/AppIcon.jsx`:
glyph `0.6×` the canvas, full stop `0.16×` the glyph, optical nudge `-0.035×`,
radial board gradient `#17171d → #08080a`, a tight green box-shadow glow.

The master is **full-bleed** (no rounded corners) — iOS / Android / PWA apply
their own corner mask, so we never bake one in.

## Files

- `gen_icon.py` — the generator (the source of truth for the raster assets).
- `Doto-Black.ttf` — Doto weight 900, the LED face. Pulled from Google Fonts:
  `https://fonts.googleapis.com/css2?family=Doto:wght@900` (the static `.ttf`
  instance). Vendored so regeneration is deterministic and offline.
- `icon-1024.png` — the full-bleed 1024² master (reference / store upload).

## Regenerate

```bash
uv run --with pillow --with numpy python brand/gen_icon.py
```

Writes the master here and the served sizes to `../public/`:
`apple-touch-icon.png` (180), `icon-512.png`, `icon-192.png`,
`favicon-32.png`, `favicon-16.png`. They are wired into `index.html`.
