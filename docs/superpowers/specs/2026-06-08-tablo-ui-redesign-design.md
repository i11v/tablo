# tablo — UI Redesign (final mobile + desktop design) — Design

**Date:** 2026-06-08
**Status:** Approved design (pre-implementation)

## 1. Summary

The app today is functionally complete but visually a placeholder: a single
GitHub-grey column of boards with emoji vehicle icons (`packages/web/src/App.tsx`
+ `styles.css`). The final design has been prototyped in `docs/design-files/`
(`tablo-v3.html` = mobile, `tablo-desktop-states.html` = desktop, sharing
`tablo-board.jsx`). This change replaces the **presentation layer** with that
design as a single responsive SPA.

The data layer is kept intact. This is a re-skin plus **one new feature**:
reachability coloring (make / run / miss), driven by geolocation walk-time.

### Goals
- Mobile (`tablo-v3`) and desktop (`tablo-desktop-states`) implemented as **one
  responsive SPA** sharing the same `StopCard` component.
- Pixel-faithful to the prototype: dark theme, `Doto` accent font for the
  wordmark / clock / countdowns, `Hanken Grotesk` for UI, the chip/rail/glow
  treatment.
- **Reachability tiers** computed live: each departure colored by whether you can
  catch it given how long it takes *you* to walk to the stop.
- Styling via **Tailwind v4**, with the design encoded as customized theme tokens.

### Non-goals
- No change to the data layer: WS protocol, gateway, Durable Objects, board
  pipeline, `useDepartures` / `useStopIndex` / `useNow`, `matcher` / `ranker`,
  `storage`, `url` codec, and the `selection` model are all preserved as-is.
- No backend work. Walk-time is computed entirely client-side from coordinates
  already present in the stop index.
- No routing/turn-by-turn walk estimate — straight-line distance with a detour
  factor is sufficient (an estimate, surfaced as such).
- No reverse-geocoding service — the location chip names the nearest indexed stop.

## 2. Decisions (locked with user)

| Decision | Choice |
|----------|--------|
| Walk-time source | **Geolocation (auto)** — device location + stop `lat`/`lon`, haversine → minutes |
| Scope | **Both breakpoints, one responsive SPA** |
| Styling | **Tailwind v4** (CSS-first `@theme`), customized to the design tokens |
| Accent font utility name | `font-accent` (not `font-led`) |
| Location denied/unavailable | **Neutral fallback** — app fully usable, tier coloring off |
| Fonts delivery | Google Fonts `<link>` in `index.html` (self-hosting via `@fontsource` is a later perf tweak) |

## 3. Scope of change

**Replaced:** `packages/web/src/App.tsx`, `packages/web/src/styles.css`.
**Added:** Tailwind v4 toolchain + a `components/`, a few `lib/` and `hooks/`
modules (§5).
**Edited:** `packages/web/index.html` (font links), `packages/web/vite.config.ts`
(Tailwind plugin), `packages/web/package.json` (deps).
**Dropped (mockup scaffolding, never ships):** phone frame, browser-window chrome
(`browser-window.jsx`), fake iOS status bar, fake browser tabs, the static
`tablo-data.js` mock.
**Untouched:** everything in `packages/contract` and `packages/worker`.

## 4. Design tokens — Tailwind v4 `@theme`

Tailwind v4 is CSS-first (no `tailwind.config.js`). `styles.css` becomes:

```css
@import "tailwindcss";

@theme {
  --font-ui:     'Hanken Grotesk', system-ui, sans-serif;   /* → font-ui     */
  --font-accent: 'Doto', monospace;                          /* → font-accent */

  --color-bg: #08080a;  --color-card: #0f0f12;  --color-edge: #1f1f25;
  --color-ink: #ECEAE3; --color-meta: #76767e;
  --color-chip: #1b1b20; --color-chip-ink: #E7E5DE;
  --color-paper: #e9e7e0;            /* light CTA / active platform chip / pin badge */
  --color-make: #22e06b; --color-run: #ffb02e; --color-miss: #ff3b4e;
  --radius-card: 13px; --radius-chip: 7px;
}

@layer base {
  /* page radial-gradient background, font smoothing, custom scrollbars */
}
```

Generated utilities used throughout: `bg-bg`, `bg-card`, `border-edge`,
`text-ink`, `text-meta`, `font-accent`, `font-ui`, `text-make`/`run`/`miss`,
`rounded-card`, `rounded-chip`. Recurring odd metrics become tokens; genuine
one-offs use arbitrary values (`text-[17px]`, `gap-[9px]`).

### 4.1 Data-driven tier color

A row's tier (make / run / miss / neutral) is chosen at runtime and applied to
four surfaces: the count text, its LED glow, the side rail + rail glow, and the
tier label chip. Static utilities cannot name a runtime color cleanly. Pattern:
set **one CSS custom property** on the row, reference it via arbitrary utilities.

```tsx
<div style={{ "--tier": tierColor }}>           {/* the only inline style: a CSS var, no layout */}
  <span className="font-accent text-[var(--tier)] [text-shadow:0_0_14px_var(--tier)]" />
  <span className="rounded-[3px] bg-[var(--tier)] shadow-[0_0_9px_var(--tier)]" />
  <span className="rounded-[4px] bg-[var(--tier)] text-[11px] text-[#0b0b0b]" />
</div>
```

`tierColor` comes from `lib/tier.ts`. No class safelisting, no visual drift.
Neutral tier → a plain off-white var, no glow, no tier chip.

## 5. Architecture

Design tokens live in `styles.css` (`@theme`) — there is no JS token module.

```
packages/web/src/
  lib/
    tier.ts               tier name → hex color (+ label); neutral when walk unknown
    reach.ts              margin = inMinutes − walkMinutes → "make" | "run" | "miss"
    geo.ts                haversine(metres); metresToWalkMinutes (~80 m/min × 1.3 detour)
    departureVM.ts        Departure + nowMs → row view-model (see §6)
  hooks/
    useGeo.ts             navigator.geolocation.watchPosition → Geo state (§7)
    (existing: useDepartures, useStopIndex, useNow — unchanged)
  components/
    icons.tsx             SearchIcon, WalkIcon, StopGlyph, VehicleIcon (tram/bus/metro)
    RouteChip.tsx  Count.tsx  Meta.tsx  PlatChip.tsx
    LeadRow.tsx  Row.tsx                  departure rows (lead = larger)
    StopCard.tsx                          header, platform filter chips, lead + rows
    SearchView.tsx                        mobile full-screen search (replaces board)
    SearchPanel.tsx                       desktop app-bar popover search
    EmptyState.tsx  AddTile.tsx
    AppBar.tsx                            wordmark, live dot, search, location chip, clock
  App.tsx                                 responsive orchestrator
```

Each component is presentational and prop-driven; `App.tsx` owns the data
plumbing and passes view-models down — so components can be unit-tested without
the WS or geolocation.

## 6. Data flow — the adapter

The prototype components consume a stop shape:
`{ name, node, walkMinutes, departures: [{ route, kind, headsign, platform, inMinutes, delay, atStop }] }`.

`App.tsx` builds this per `selection` entry from the real data:

- **walkMinutes** ← `useGeo()` position + the selected node's `lat`/`lon` from
  `useStopIndex` (haversine). `null` when location is locating/denied → neutral.
- **departures** ← the board's `Departure[]` (`boards.get(selectorKey(sel))`),
  mapped by `departureVM(dep, nowMs)`:
  - `inMinutes` ← `round((Date.parse(predicted ?? scheduled) − nowMs) / 60000)`,
    clamped at 0.
  - `delay` ← `delaySeconds`: `null`/0 → `"on time"`; else `"+N"` / `"−N"` minutes.
  - `atStop` ← `isAtStop`.
  - `platform` ← `platform`.
  - **filter out** `isCanceled` and "gone" (departed > 30 s ago, reuse the
    `countdown` gone rule).
  - **sort ascending** by `predicted ?? scheduled` — the design relies on order
    for lead-vs-rest selection and `leadIdx = first non-miss`.
- **reach()** colors each row. When `walkMinutes` is `null`, every row is
  `neutral`: counts render plain, no tier chips, no "min walk" — the app stays
  fully usable without location.

`Count` semantics (from the prototype): `atStop` → `"NOW"`; `inMinutes === 0` →
`"<1"`; else the integer (+ "min" suffix on the large lead count only).

The existing per-stop platform filter persists under `localStorage` key
`tablo.pf.<node>` (already in the prototype's `StopCard`).

## 7. Reachability + geolocation

`hooks/useGeo.ts` exposes:

```ts
type Geo =
  | { tag: "locating" }
  | { tag: "denied" }                              // or unsupported / error
  | { tag: "active"; lat: number; lon: number }
```

- Requests location once on mount via `watchPosition`, updates live; cleans up on
  unmount.
- `denied` / unsupported / error → neutral mode throughout (no throw, no nag loop).
- The **location chip** (`AppBar`) shows the **nearest indexed stop** name (cheap
  scan of `index.stops` by haversine — no geocoding API): `⌖ <nearest>` when
  active, `Locating…` while pending, `Location off` when denied (tapping it can
  re-request).
- Tiers recompute live as `useNow` ticks and as position updates.

`lib/reach.ts` (mirrors the prototype's `reach`):
`margin = inMinutes − walkMinutes`; `< 0 → miss`, `< 2 → run`, else `make`.

`lib/geo.ts`: haversine in metres; `metresToWalkMinutes = round(metres / 80 *
1.3)` (~4.8 km/h, ×1.3 detour). Constants documented inline; the estimate is
surfaced as "min walk", not a promise.

## 8. Responsive layout

One breakpoint at **640px** (Tailwind `sm`).

- **Mobile (< 640px)** — single column. App bar: wordmark + live dot + clock.
  An "Add a stop…" tile sits in the scroll area; tapping it opens the
  full-screen `SearchView` that replaces the board (per `tablo-v3`).
- **Desktop (≥ 640px)** — app bar carries an inline search box opening a
  `SearchPanel` popover, a location chip, and the clock. Body is
  `grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr))` so 2 stops
  fill from the left, 4 span the width, 6 wrap and the page scrolls — covering all
  four documented desktop states (Empty / Few / Full / Overflow) with one rule.
  `AddTile` is the last grid cell.

The clock uses `useNow` (real time), `font-accent`. The live dot + a sub-bar
text line reflect WS status (§9).

## 9. State mapping (real → design language)

| Real state | Rendering |
|------------|-----------|
| `index._tag === "loading"` | search disabled, placeholder "Loading stops…" |
| `index._tag === "failed"` | error line (design's muted/alert treatment) |
| `selection.length === 0` | `EmptyState` (desktop) / mobile empty prompt |
| board `undefined` (no data yet) | in-card "waiting…" skeleton |
| `status === "live"` | green live dot, sub-bar "… · live" |
| `status === "degraded"` | amber dot, "degraded" note |
| `status === "connecting" \| "reconnecting"` | red pulsing dot, "reconnecting…" |
| geo `locating` / `denied` / `active` | location chip state; tiers neutral unless active |

## 10. Testing

- `lib/reach.ts` — margin → tier boundaries (miss/run/make at −1, 0, 1, 2).
- `lib/geo.ts` — haversine against known Prague coordinate pairs; minutes rounding.
- `lib/departureVM.ts` — delay formatting (`+`/`−`/on time), `atStop`/`<1`/`min`,
  canceled + gone filtering, ascending sort.
- Existing `matcher` / `countdown` / `url` tests stay green.
- Manual: run the app, grant + deny location, verify tier coloring vs neutral,
  resize across 640px, exercise Empty / Few / Full / Overflow.

## 11. Out of scope / future

- Self-hosting fonts via `@fontsource` (perf / privacy).
- Per-platform coordinates for finer walk-time on pinned single-platform cards
  (node-level lat/lon is used for now).
- Manual walk-time override per card.
- Reverse-geocoding the location chip to a street/place rather than nearest stop.
