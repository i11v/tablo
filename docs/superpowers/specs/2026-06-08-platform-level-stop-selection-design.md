# tablo — Platform-Level Stop Selection — Design

**Date:** 2026-06-08
**Status:** Approved design (pre-implementation)

## 1. Summary

Today a stop search returns one entry per (ASW node, name): selecting "Anděl"
subscribes to the **whole node**, so the board mixes departures from every
platform and direction. When you only want to catch a specific tram, you have to
scan a merged list of all directions to find the one leaving from your platform.

This change makes platform-level selection a first-class option **alongside** the
existing whole-stop selection. Searching `andel` surfaces both levels:

```
Anděl (A, B, C…)     ← whole stop  (selector: node 1040, stops: null)
Anděl · A            ← one platform (selector: node 1040, stops: [1])
Anděl · B            ← one platform (selector: node 1040, stops: [2])
…
```

Picking the grouped row gives a stop card spanning all platforms (as today).
Picking a platform row gives a board filtered to that platform — a clean list of
the vehicles leaving from exactly where you're standing.

### Goals
- Search surfaces both the whole stop and each of its platforms as selectable rows.
- A platform selection yields a board scoped to that platform only.
- The data model exposes each stop's platform list so any future grouped-card
  layout (sectioned / merged+badge / filter chips) can be built without
  re-touching the index.

### Non-goals
- The grouped-card visual layout — sectioning, per-row platform badges, filter
  chips. These will be decided later via a clickable prototype. This design only
  guarantees the **data** to support any of them.
- Platform-level geo features (nearest platform, per-platform coordinates).
- Any change to the wire protocol, gateway, board pipeline, or URL/storage
  encoding.

## 2. Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Platform representation | One grouped index entry per stop carrying a `platforms[]` array; the matcher expands matches into grouped + per-platform candidates at query time | Keeps the index ~9k entries (not ~26k rows), build logic close to today, and hands the future grouped card a ready-made platform list. |
| Selector model | **Unchanged** — `{node, stops}` already supports a single platform via `stops: [id]` | The whole runtime path (`normalize.matches`, gateway, URL, storage) needs no change. This refactor is additive at the index + search layer. |
| Index schema version | **Stay on `version: 1`**, regenerate the artifact | The index is a content-hashed build artifact fetched via the manifest; there's no old-shape file for a client to decode, so a V2/migration would be boilerplate for zero benefit. |
| Blank platform codes (~3.6%) | Kept in the grouped selector scope, **excluded** from `platforms[]` | Nothing to label or search by; they still appear in the whole-stop board via the node-wide selector. |

## 3. Data model

### 3.1 Contract (`packages/contract/src/stop-index.ts`)

Add a platform sub-shape and a `platforms` field to each entry:

```ts
export const StopPlatform = Schema.Struct({
  code: Schema.String,   // platform_code: "A".."H", "1", "2"
  stop: Schema.Number,   // asw_stop_id — selector scope when this platform is picked alone
})

export const StopIndexEntry = Schema.Struct({
  // ...existing fields (name, norm, node, stops, lat, lon, zone, modes, disambig)
  platforms: Schema.Array(StopPlatform),   // NEW — non-blank-code platforms in this stop
})
```

- `platforms` lists only platforms whose `platform_code` is non-blank, sorted by
  code.
- `platforms` is always present (possibly `[]`). A single-platform stop has a
  length-1 array, and search will **not** expand it (grouped == the platform).
- The existing `stops` field is unchanged and remains the grouped selector scope:
  `null` for single-name nodes (whole node), the name's platform-id list for
  multi-name nodes. Blank-code platforms therefore stay in scope.

### 3.2 Real-data grounding (PID GTFS `stops.txt`, verified 2026-06-08)

- `platform_code` is populated for **96.4%** of platform rows
  (`location_type=0` with an ASW node): letters `A`–`H` for trams/buses, digits
  for metro.
- Example — node 1040 "Anděl" has 9 platforms: trams `A B C D F G H` plus metro
  `1 2` (the `location_type=1` station row is excluded as today).
- Each live `Departure` already carries `platform` (from `d.stop.platform_code`),
  so a grouped card can render per-platform with no protocol change.

## 4. Build (`scripts/lib/build.ts`)

- Read the existing `platform_code` column (`iPlat = need("platform_code")`).
- Each `Group` additionally accumulates a `Map<stopId, code>`. After grouping,
  emit `platforms = [{code, stop}]` for non-blank codes, sorted by `code`.
- `stops` selector logic is **unchanged** (`null` for single-name nodes; the
  name's platform-id list — including blank-code platforms — for multi-name
  nodes).
- Disambiguation, centroid, zone-mode, and sort logic are unchanged.

## 5. Search (`packages/web/src/lib/matcher.ts`)

`Candidate` carries its own selector scope and platform label:

```ts
export interface Candidate {
  readonly entry: StopIndexEntry
  readonly platform: string | null   // null = whole stop; else the platform code
  readonly stops: number[] | null    // selector scope for THIS candidate
  readonly score: number
}
```

Search expands each entry into "searchables", then the **existing scoring loop
runs unchanged** over them:

- grouped: `{ platform: null, stops: entry.stops, norm: entry.norm }`
- per-platform (only when `entry.platforms.length > 1`), for each platform `p`:
  `{ platform: p.code, stops: [p.stop], norm: entry.norm + " " + fold(p.code) }`

**Sorting operates on the searchable's `norm`, not `entry.norm`** — important,
because the grouped row and all its platforms share the *same* `entry`, so an
`entry.norm`-based tiebreak (as the current matcher uses) could not order grouped
before platform. The scoring loop scores against the searchable `norm` and the
sort key is `score desc → searchable-norm length asc → searchable-norm
localeCompare`; the validated `Candidate` is mapped out afterward (the internal
`norm` is not part of the public shape). This single change preserves today's
cross-stop ranking (shorter stop names first — e.g. `Anděl` before `Andělka`)
while also placing each stop's grouped row (norm `andel`, length 5) ahead of its
platforms (norm `andel a`, length 7). Consequences of the suffixed norm:

- `andel` → grouped row + every platform (each platform norm starts with
  `andel`).
- `andel a` → only platform A (grouped norm `andel` does not start with
  `andel a`).

`ranker.ts` is unchanged — it reads `c.entry.node` for the recents boost and
spreads the remaining fields through.

## 6. App wiring (`packages/web/src/App.tsx`)

- `add(c)`: selector `{ node: c.entry.node, stops: c.stops }`; name
  `c.platform ? \`${c.entry.name} ${c.platform}\` : c.entry.name`;
  `pushRecent(c.entry.node)`.
- Result row label: a platform candidate shows a badge (`Anděl · A`); the grouped
  candidate shows a truncated platform list (`Anděl (A, B, C…)`) derived from
  `entry.platforms`.
- Dedup check and list `key` switch to the candidate's selector:
  `selectorKey({ node: c.entry.node, stops: c.stops })`.
- The empty-query recents path produces grouped candidates only
  (`{ entry, platform: null, stops: entry.stops, score: 0 }`) — recents are
  per-node.

## 7. Unchanged components (the additive payoff)

`StopSelector`, the protocol, `gateway/service.ts`, `golemio/client.ts`,
`golemio/normalize.ts`, `url.ts`, `storage.ts`, and board rendering all stay as
they are. A platform selection already flows through `normalize.matches()`
(`sel.stops.includes(asw.stop)`) → a filtered flat board, which **is** the
"list of vehicles from this platform" experience. The grouped board already
merges all platforms; the richer grouped-card layout will be built later from
`entry.platforms` + the per-departure `platform` already on the wire.

## 8. Testing

- `scripts/test/build.test.ts`: set `platform_code` in fixture rows; assert
  `platforms` is populated per (node, name), blank codes are excluded, and
  multi-name scoping is intact.
- `packages/web/test/matcher.test.ts`: `andel` → grouped candidate first, then
  platforms A/B; `andel a` → only platform A; a single-platform stop is not
  expanded.
- `packages/contract/test/stop-index.test.ts`: schema accepts the new
  `platforms` field.

## 9. Backward compatibility

- Selector wire shape is unchanged, so existing saved boards (URL +
  `localStorage`) remain valid: a whole-node selection still loads the grouped
  card; a `stops: [id]` selection still loads a platform board.
- The index artifact is regenerated with a new content hash; clients fetch it via
  the manifest, so there is no stale-shape decode path.
