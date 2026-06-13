# tablo brand assets — the `t.` app icon

The product icon is the wordmark reduced to its initial: a Doto **`t`** + the
green **make-square** that doubles as the live-connection signal, on the warm
board ground. Geometry ports the **`bleed`** branch of
`tablo-design-system/components/brand/AppIcon.jsx`: the glyph is blown up to
`1.22×` the canvas so the **`t` owns the whole tile** (the old `0.6×` glyph read
as a padded, shrunken icon on the Home Screen), the make-square (`0.16×` the
glyph) is anchored **low-right** as a deliberate accent, the glyph is nudged
**down** `0.05×` so the optical space above/below balances, on the radial board
gradient `#17171d → #08080a` with a tight green box-shadow glow.

The master is **full-bleed** in both senses: no rounded corners (iOS / Android /
PWA apply their own mask, so we never bake one in) *and* the mark itself fills
the tile edge-to-edge with no padding.

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
