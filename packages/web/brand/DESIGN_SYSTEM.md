# tablo — design system (implementation notes)

How the **tablo** brand + token system is wired into `@app/web`, and the rules
behind it. Written so the details survive — the canonical source is a Claude
Design handoff bundle that does **not** live in this repo.

> **tablo** turns Prague's live transit feed into one judgement — *can I still
> catch it?* Every departure is a glowing LED countdown scored against your walk
> time: **green** (catch it) · **amber** (run) · **red** (missed), on a warm
> near-black board. One visual language across phone, web, and a public
> wallboard — same `StopCard`, only the scale changes.

## Provenance

The system was designed in **Claude Design** (claude.ai/design) and exported as
a handoff bundle (`tablo-design-system/`, gzipped tar fetched from an
`api.anthropic.com/v1/design/h/…` URL). The bundle holds the token CSS, React
brand + transit components, three UI kits, specimen cards, and the design-chat
transcripts (the real intent source). It is the **canonical reference**; this
repo is the production implementation. `packages/web/src/styles.css` is the
upstream the bundle's `@theme` mirrors — they are kept in sync.

This is the **second** uptake. The first attempt built a separate
`@app/design-system` package (branch `worktree-tablo-design-system`) from an
earlier bundle; it was superseded. This implementation lives directly in
`@app/web` (the foundation — tokens, tiers, StopCard, primitives — already
existed here, so only the brand layer was genuinely new).

## Tokens

All tokens are a Tailwind v4 `@theme` in `src/styles.css`; each is both a CSS
variable (`var(--color-make)`) and a generated utility (`bg-make` / `text-make`
/ `border-make`). Two groups:

1. **Canonical bundle tokens** — surfaces (`bg`→`card`→`chip`→`ctl`→`edge`),
   warm-bone ink ramp (`ink`/`ink-dim`/`meta`/`chip-ink`/`paper`/`paper-ink`),
   reachability (`make`/`run`/`miss`/`neutral` + `on-*` contrast inks),
   supporting (`late`/`early`/`icon`/`add-ok`), the UI + LED **type scale**,
   **tracking**, all four **radii**, and `shadow-overlay`. Plus base-layer
   `:root` props (`--ground`, `--glow-make/run/miss`, `--dot-glow`,
   `--row-lead/secondary`) and the `led-make/run/miss` + `dot-glow` `@utility`s.

2. **App chrome neutrals** (clearly commented in `styles.css`, **not** in the
   bundle) — UI furniture the design never specified: `faint` (placeholders),
   `ctl-ink` / `field-ink` / `chip-muted` (inactive control text), `clock` /
   `clock-dim`, `ghost` / `ghost-label` / `ghost-icon` (the empty/add
   affordance), `sunken` (inset fields), `edge-2` / `edge-hover`. A handful of
   near-identical ad-hoc greys were snapped to these (≤~13/255) to kill drift.
   If the bundle ever defines these roles, fold them back into group 1.

There are **no inline hex colors in components** — every color is a token. The
only literal hexes left are the token *definitions* in `styles.css`.

## Brand rules (the must-knows)

- **Wordmark `tablo.`** (`chrome.tsx` `<Wordmark>`). Lowercase Doto + a **square
  full stop that IS the live-connection signal** — green (`make`) connected,
  amber (`run`) degraded, red (`miss`) connecting/offline, mapped from
  `WsStatus`. The stop is a **CSS square** sized `0.16em` (Doto's native period
  reads as a "+", which collides with the add `+`), with a **static glow — never
  a pulse**. Never capitalised.
- **App icon `t.`** — the wordmark reduced to its initial, on the warm board
  ground. Rendered from the real Doto Black outlines by `brand/gen_icon.py`;
  master is **full-bleed** (no baked corners — the OS masks). See
  [README.md](./README.md). Wired into `index.html` (favicon + apple-touch).
- **Reachability hues are reserved** — `make`/`run`/`miss` mean *catch/run/miss*
  and nothing decorative may borrow them. `add-ok` is a deliberately *different*
  green so the add button never reads as a score.
- **Mode by silhouette, never colour** — tram (pantograph) / bus / metro (M
  roundel) are monochrome `icon`-stroke pictograms (`icons.tsx`).
- **Typography** — **Doto** (`font-accent`) only for LED numerals + the
  wordmark; **Hanken Grotesk** (`font-ui`) for everything else.
- **Warm, never blue-cold** — no pure white, no cool grey. (A few legacy chrome
  greys are faintly cool; flagged, kept as-is to avoid an unrequested reskin.)
- **Dark-only.** No light theme — the LED board has none.
- **Flat surfaces** — cards never cast; only overlays/devices use
  `shadow-overlay`. Two glow systems only: LED text-shadow on Doto numerals,
  box-shadow halo on status dots.
- **16px input floor (hard rule)** — `styles.css` floors all
  `input`/`textarea`/`select` at `--text-input` (16px); iOS Safari auto-zooms on
  smaller fields and never zooms back. Scale with `transform` if it must look
  smaller — never drop the font-size.
- **No emoji / no Unicode pictographs** in UI; only `+`/`✓`/`✕` as controls.
- **Czech rendered with diacritics** exactly (`Anděl`, `Sídliště`, `nást. J`).

## Gotchas (learned the hard way)

- **Tailwind v4 tree-shakes `@theme` vars that no class references.** A token
  used only via an inline `var(--color-…)` (e.g. a `color=` prop) gets dropped
  from `:root` and resolves to nothing. Fixes used here: reference it through a
  literal utility class (the `on-make/run/miss` verdict inks use `text-on-*`
  classes), or — for prop-only tokens like `ghost-icon` — define it in the plain
  `:root` block instead of `@theme`. Verify with
  `grep -- --color-x dist/assets/*.css` after a build.

## Verify / regenerate

```bash
bunx tsc -p packages/web && bun run --cwd packages/web build   # typecheck + build
bun run vite dev   # then open /preview.html for the component board (mock data)
uv run --with pillow --with numpy python brand/gen_icon.py     # rebuild the t. icon
```
