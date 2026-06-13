# tablo brand assets — the `t.` app icon

The product icon is the wordmark reduced to its initial: a Doto **`t`** + the
green **make-square** full stop that doubles as the live-connection signal, on
the warm board ground — the single-glyph echo of the **`tablo.`** wordmark.
Geometry ports the default `t.` lockup of
`tablo-design-system/components/brand/AppIcon.jsx`: the **`t` + full-stop square**
(`0.16×` the glyph, resting on the baseline) are centred as **one unit**, with
the glyph sized `0.70×` the canvas, on the radial board gradient
`#17171d → #08080a` with a tight green box-shadow glow.

`0.70×` is bigger than the design's nominal `0.6×` (which read as a tiny, padded
mark on the Home Screen) but stops short of a true full bleed: blowing the lone
`t` up to own the whole tile leaves the off-diagonal corners dead once iOS masks
the rounded corners, so the centred lockup is what reads balanced on-device.

The master is **full-bleed** in the no-corners sense — no rounded corners baked
in (iOS / Android / PWA apply their own mask).

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

Writes the master here (`icon-1024.png`) and the **PWA generator source**
`../public/icon.png`. The favicon / apple-touch / maskable / manifest icon set
is produced from `public/icon.png` at build time by `vite-plugin-pwa` +
`@vite-pwa/assets-generator` (see `pwa-assets.config.ts`), which also injects
the `<link>` tags — so there are no hand-maintained favicon files or links.
