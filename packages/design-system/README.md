# @app/design-system

The **tablo** design system as a consumable workspace package: the token
source-of-truth (CSS custom properties) and the brand components.

tablo is a warm near-black LED departure board where countdowns glow
**green / amber / red** to mean *catch it / run / missed*. These three hues
(`--make` / `--run` / `--miss`) are semantic and reserved — never decorative.
Dark-only; no light theme. Numbers and the wordmark are set in **Doto** (the LED
dot-matrix face); everything else in **Hanken Grotesk**.

This bundle was handed off from [claude.ai/design](https://claude.ai/design); the
full system (transit primitives, UI kits, specimen cards) lives in that project.
The pieces re-homed here are the **token layer** and the **brand layer** — the
parts that are genuinely shared across surfaces and were the focus of the design
iteration (the `tablo.` full-stop wordmark and the `t.` app icon).

## Usage

### Tokens (CSS)

```css
/* App that owns its own base layer + font loading (e.g. @app/web + Tailwind): */
@import "@app/design-system/tokens.css"; /* :root vars only, no side-effects */

/* Standalone consumer (also pulls webfonts + the dark board base layer): */
@import "@app/design-system/styles.css";
```

`tokens.css` defines the colors, type scale, spacing/radii, and glow helpers as
`:root` custom properties (`--make`, `--card`, `--font-accent`, `--track-led`,
`--radius-card`, …). The brand components below read these vars, so a consumer
must load one of the two CSS entries.

### Components

```tsx
import { Wordmark, AppIcon } from "@app/design-system"

// Brand lockup — the green full stop IS the live-feed signal.
<Wordmark size={34} connected={wsConnected} />        // tablo.  (green = connected)
<Wordmark size={34} connected={false} />              // tablo.  (red = backend unreachable)
<Wordmark size={34} signal="pip" />                   // legacy floating round dot
<Wordmark size={34} live={false} />                   // static / print — no signal

// Product icon — the mark reduced to its initial.
<AppIcon size={180} />                                // installed (rounded) preview
<AppIcon size={1024} rounded={false} />               // export master — full-bleed square
```

Components are plain React + inline styles referencing the CSS vars (no CSS-in-JS,
no runtime deps beyond React, which is a peer dependency). They are consumed as TS
source — there is no build step.

## What's here

- `src/tokens/` — `fonts.css`, `colors.css`, `typography.css`, `spacing.css`,
  `base.css` (mirrored verbatim from the design bundle, whose upstream is
  `packages/web/src/styles.css`'s `@theme` block).
- `src/tokens.css` — side-effect-free `:root` vars (colors + type + spacing).
- `src/styles.css` — full standalone entry (fonts + tokens + dark base layer).
- `src/brand/Wordmark.tsx`, `src/brand/AppIcon.tsx` — the brand components.

## Brand rules (essentials)

- **Wordmark** is always lowercase, always Doto. The signal is a **connection
  indicator**, not decoration: `--make` green when the backend feed is connected,
  `--miss` red when it isn't. Canonical form is `tablo.` — the green period is the
  signal. The `AppIcon` reduces this to the initial: `t.`.
- **Reachability hues are reserved.** `--make` / `--run` / `--miss` mean
  catch / run / miss only — nothing decorative borrows them.
- **16px input floor (hard rule).** iOS Safari auto-zooms any focused input below
  16px and never zooms back out; `base.css` floors `input`/`textarea`/`select` at
  `--text-input` (16px). Scale with `transform` if a field must look smaller.
