# Platform-Level Stop Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each stop's individual platforms selectable from search (alongside the existing whole-stop selection), so a board can be scoped to one platform/direction.

**Architecture:** Additive at the index + search layer. The build adds a `platforms[]` array to each grouped stop entry; the search matcher expands a matched entry into a grouped candidate plus one candidate per platform, each carrying its own selector scope (`stops: [id]`). The runtime selector model (`{node, stops}`), wire protocol, gateway, board pipeline, and URL/storage encoding are unchanged.

**Tech Stack:** TypeScript 6, Effect v4 (beta) `Schema`, React + Vite, Vitest, Bun. Monorepo: `packages/contract` (shared schema), `packages/web` (SPA), `scripts` (index builder).

**Reference spec:** `docs/superpowers/specs/2026-06-08-platform-level-stop-selection-design.md`

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/contract/src/stop-index.ts` | Modify | Add `StopPlatform` schema + required `platforms` field on `StopIndexEntry`. |
| `packages/contract/test/stop-index.test.ts` | Modify | Cover `platforms` in the v1 decode test. |
| `scripts/lib/build.ts` | Modify | Read `platform_code`; emit per-(node,name) `platforms[]` (non-blank codes). |
| `scripts/test/build.test.ts` | Modify | Assert `platforms` population, blank-code exclusion, multi-name scoping. |
| `packages/web/public/data/*` | Regenerate | New content-hashed index artifact + manifest, now carrying `platforms`. |
| `packages/web/src/lib/matcher.ts` | Modify | `Candidate` carries `platform`/`stops`; expand grouped + per-platform; sort on searchable norm. |
| `packages/web/test/matcher.test.ts` | Modify | New expansion/platform-search tests; keep existing tests green. |
| `packages/web/src/App.tsx` | Modify | Consume the richer `Candidate`: per-platform selector, label/badge, dedup. |
| `packages/web/src/lib/ranker.ts` | No change | Verified to pass new fields through unchanged. |

**Commands (run from repo root):**
- Typecheck: `bun run typecheck`
- All unit tests: `bun run test`
- One test file: `bunx vitest run <path>`
- Regenerate index: `bun run build:index`

Every commit message ends with the trailer:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## Task 1: Add `platforms` to the index data model (schema + build)

The schema field is **required**, and the build emits it — these land together so every commit's typecheck and tests stay green. Making it required also touches the two `StopIndexEntry` literals in tests (`stop-index.test.ts`, `matcher.test.ts`'s `entry()` helper).

**Files:**
- Modify: `packages/contract/src/stop-index.ts`
- Modify: `packages/contract/test/stop-index.test.ts`
- Modify: `scripts/lib/build.ts`
- Modify: `scripts/test/build.test.ts`
- Modify: `packages/web/test/matcher.test.ts` (keep `entry()` helper typechecking — no behavior change yet)

- [ ] **Step 1: Write the failing build test for `platforms`**

In `scripts/test/build.test.ts`, add `platform_code` to the Anděl and Dělnická/Tusarova fixture rows, and add assertions. Change the four data rows to:

```ts
  row({ stop_id: "U1040Z1P", stop_name: "Anděl", stop_lat: "50.0710", stop_lon: "14.4030", zone_id: "P", asw_node_id: "1040", asw_stop_id: "1", platform_code: "A" }),
  row({ stop_id: "U1040Z2P", stop_name: "Anděl", stop_lat: "50.0712", stop_lon: "14.4032", zone_id: "P", asw_node_id: "1040", asw_stop_id: "2", platform_code: "B" }),
  // node 81 carries two distinct names -> platform-scoped entries
  row({ stop_id: "U81Z1P", stop_name: "Dělnická", stop_lat: "50.10", stop_lon: "14.45", zone_id: "P", asw_node_id: "81", asw_stop_id: "1", platform_code: "A" }),
  row({ stop_id: "U81Z2P", stop_name: "Tusarova", stop_lat: "50.11", stop_lon: "14.46", zone_id: "P", asw_node_id: "81", asw_stop_id: "2", platform_code: "B" }),
```

Extend the "single-name nodes" test to assert platforms:

```ts
  it("groups single-name nodes as whole-node entries with centroid", () => {
    const andel = index.stops.find((s) => s.name === "Anděl")
    expect(andel).toBeDefined()
    expect(andel!.node).toBe(1040)
    expect(andel!.stops).toBeNull()
    expect(andel!.lat).toBeCloseTo(50.0711, 4)
    expect(andel!.zone).toBe("P")
    expect(andel!.norm).toBe("andel")
    expect(andel!.platforms).toEqual([{ code: "A", stop: 1 }, { code: "B", stop: 2 }])
  })
```

Extend the "multi-name nodes" test:

```ts
  it("splits multi-name nodes into platform-scoped entries", () => {
    const delnicka = index.stops.find((s) => s.name === "Dělnická")
    const tusarova = index.stops.find((s) => s.name === "Tusarova")
    expect(delnicka!.stops).toEqual([1])
    expect(tusarova!.stops).toEqual([2])
    expect(delnicka!.node).toBe(81)
    expect(delnicka!.platforms).toEqual([{ code: "A", stop: 1 }])
  })
```

Add a dedicated blank-code test at the end of the `describe("buildIndex", ...)` block:

```ts
  it("excludes blank platform_code from platforms but keeps the stop in node scope", () => {
    const idx = buildIndex(
      [
        HEADER,
        row({ stop_id: "U70Z1", stop_name: "Xstop", asw_node_id: "70", asw_stop_id: "1", platform_code: "A" }),
        row({ stop_id: "U70Z2", stop_name: "Xstop", asw_node_id: "70", asw_stop_id: "2", platform_code: " " }),
      ],
      "2026-06-06T00:00:00.000Z",
    )
    const x = idx.stops.find((s) => s.name === "Xstop")!
    expect(x.platforms).toEqual([{ code: "A", stop: 1 }])
    expect(x.stops).toBeNull() // single-name node: whole-node selector still covers stop 2
  })
```

- [ ] **Step 2: Run the build test to verify it fails**

Run: `bunx vitest run scripts/test/build.test.ts`
Expected: FAIL — `andel!.platforms` is `undefined` (build does not emit it yet); also the schema-valid test may still pass until Step 3.

- [ ] **Step 3: Add `StopPlatform` + `platforms` to the contract schema**

In `packages/contract/src/stop-index.ts`, add the platform struct above `StopIndexEntry` and the field inside it:

```ts
export const StopPlatform = Schema.Struct({
  code: Schema.String,            // platform_code: "A".."H", "1", "2"
  stop: Schema.Number,            // asw_stop_id — selector scope when picked alone
})
export type StopPlatform = typeof StopPlatform.Type

export const StopIndexEntry = Schema.Struct({
  name: Schema.String,            // display: "Anděl"
  norm: Schema.String,            // fold(name), search field
  node: Schema.Number,            // ASW node
  stops: Schema.NullOr(Schema.Array(Schema.Number)), // null = whole node
  lat: Schema.Number,
  lon: Schema.Number,
  zone: Schema.NullOr(Schema.String),
  modes: Schema.Array(VehicleKind), // empty in v1, slot reserved
  disambig: Schema.NullOr(Schema.String),
  platforms: Schema.Array(StopPlatform), // non-blank-code platforms of this stop
})
```

(`StopPlatform` is auto-exported via `packages/contract/src/index.ts`'s `export * from "./stop-index.ts"` — no edit needed there.)

- [ ] **Step 4: Emit `platforms` from the build**

In `scripts/lib/build.ts`:

(a) Read the column — after `const iStop = need("asw_stop_id")` add:

```ts
  const iPlat = need("platform_code")
```

(b) Extend the `Group` interface with a platform-code map:

```ts
  interface Group {
    name: string
    node: number
    stops: Set<number>
    lats: number[]
    lons: number[]
    zones: string[]
    plats: Map<number, string> // asw_stop_id -> trimmed platform_code
  }
```

(c) Initialize it where the group is created:

```ts
      g = { name, node, stops: new Set(), lats: [], lons: [], zones: [], plats: new Map() }
```

(d) Record the code inside the existing `if (r[iStop] !== "")` branch:

```ts
    if (r[iStop] !== "") {
      const stop = Number(r[iStop])
      g.stops.add(stop)
      g.plats.set(stop, r[iPlat].trim())
    }
```

(e) Add `platforms` to the `MutableEntry` interface:

```ts
  interface MutableEntry {
    name: string
    norm: string
    node: number
    stops: number[] | null
    lat: number
    lon: number
    zone: string | null
    modes: VehicleKind[]
    disambig: string | null
    platforms: { code: string; stop: number }[]
  }
```

(f) Populate it in the `[...groups.values()].map(...)`:

```ts
  const entries: MutableEntry[] = [...groups.values()].map((g) => ({
    name: g.name,
    norm: fold(g.name),
    node: g.node,
    stops: namesPerNode.get(g.node)!.size > 1 ? [...g.stops].sort((a, b) => a - b) : null,
    lat: Number(mean(g.lats).toFixed(5)),
    lon: Number(mean(g.lons).toFixed(5)),
    zone: mode(g.zones),
    modes: [],
    disambig: null,
    platforms: [...g.plats.entries()]
      .filter(([, code]) => code !== "")
      .map(([stop, code]) => ({ code, stop }))
      .sort((a, b) => a.code.localeCompare(b.code)),
  }))
```

- [ ] **Step 5: Update the contract decode test for the required field**

In `packages/contract/test/stop-index.test.ts`, add `platforms` to the v1 stop literal and assert it round-trips, and assert a missing `platforms` is rejected:

```ts
  it("decodes a v1 artifact and rejects unknown versions", () => {
    const v1 = {
      version: 1,
      generatedAt: "2026-06-06T00:00:00.000Z",
      stops: [{
        name: "Anděl", norm: "andel", node: 1040, stops: null,
        lat: 50.07, lon: 14.4, zone: "P", modes: [], disambig: null,
        platforms: [{ code: "A", stop: 1 }],
      }],
    }
    const dec = Schema.decodeUnknownSync(StopIndex)
    expect(dec(v1).version).toBe(1)
    expect(dec(v1).stops[0].platforms).toEqual([{ code: "A", stop: 1 }])
    expect(() => dec({ ...v1, version: 2 })).toThrow()
    const noPlatforms = { ...v1, stops: [{ ...v1.stops[0], platforms: undefined }] }
    expect(() => dec(noPlatforms)).toThrow()
  })
```

- [ ] **Step 6: Keep the matcher test fixture typechecking**

In `packages/web/test/matcher.test.ts`, add `platforms: []` to the `entry()` helper so every `StopIndexEntry` literal satisfies the new required field (no behavior change — Task 3 adds the real expansion tests):

```ts
const entry = (name: string, node: number): StopIndexEntry => ({
  name, norm: name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase(),
  node, stops: null, lat: 50, lon: 14, zone: "P", modes: [], disambig: null, platforms: [],
})
```

- [ ] **Step 7: Run unit tests and typecheck**

Run: `bun run test`
Expected: PASS — build, contract, and web tests all green (matcher behavior unchanged).

Run: `bun run typecheck`
Expected: PASS — 0 errors.

- [ ] **Step 8: Commit**

```bash
git add packages/contract/src/stop-index.ts packages/contract/test/stop-index.test.ts scripts/lib/build.ts scripts/test/build.test.ts packages/web/test/matcher.test.ts
git commit -m "feat(stops): add per-platform metadata to the stop index

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Regenerate the production index artifact

`useStopIndex` decodes the bundled index with `Schema.decodeUnknownSync(StopIndex)` (strict). With `platforms` now required, the committed artifact must be regenerated or the SPA fails to load. This downloads `PID_GTFS.zip` (~48 MB) from `data.pid.cz` and rewrites the content-hashed JSON + manifest.

**Files:**
- Regenerate: `packages/web/public/data/stop-index-*.json`, `packages/web/public/data/stops-manifest.json`

- [ ] **Step 1: Regenerate the index**

Run: `bun run build:index`
Expected: prints `stop index: <N> entries -> packages/web/public/data/stop-index-<hash>.json` and exits 0. The internal `Schema.decodeUnknownSync(StopIndexV1)(index)` guard passing confirms the new artifact carries `platforms`.

(If the GTFS download fails transiently, re-run. The schema/build change from Task 1 is independent of this step.)

- [ ] **Step 2: Verify the new artifact carries platforms**

Run: `bunx vitest run packages/contract/test/stop-index.test.ts`
Then sanity-check the file decodes by confirming the manifest points at the new hash:

Run: `git status --short packages/web/public/data`
Expected: the old `stop-index-35e3ad3e.json` is deleted, a new `stop-index-<hash>.json` is added, and `stops-manifest.json` is modified.

- [ ] **Step 3: Commit**

```bash
git add packages/web/public/data
git commit -m "chore(stops): regenerate index artifact with platform codes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Expand search into grouped + per-platform candidates, and wire selection

The `Candidate` type gains required `platform` and `stops` fields. Because `App.tsx` and `ranker.ts` consume `Candidate`, they're updated in the same task to keep typecheck green. `ranker.ts` needs no edit (it spreads `...c` through) but is verified.

**Files:**
- Modify: `packages/web/src/lib/matcher.ts`
- Modify: `packages/web/test/matcher.test.ts`
- Modify: `packages/web/src/App.tsx`
- Verify (no edit): `packages/web/src/lib/ranker.ts`

- [ ] **Step 1: Write the failing expansion tests**

In `packages/web/test/matcher.test.ts`, add a multi-platform fixture and tests inside `describe("searchStops", ...)`:

```ts
  const andelP: StopIndexEntry = {
    ...entry("Anděl", 1040),
    platforms: [{ code: "A", stop: 1 }, { code: "B", stop: 2 }],
  }

  it("expands a multi-platform stop into grouped + per-platform candidates", () => {
    const r = searchStops([andelP], "andel")
    expect(r[0].platform).toBeNull()              // grouped row first
    expect(r[0].stops).toBeNull()
    expect(r.slice(1).map((c) => c.platform)).toEqual(["A", "B"])
    expect(r[1].stops).toEqual([1])
    expect(r[2].stops).toEqual([2])
  })

  it("matches a single platform when its code is typed", () => {
    const r = searchStops([andelP], "andel a")
    expect(r).toHaveLength(1)
    expect(r[0].platform).toBe("A")
    expect(r[0].stops).toEqual([1])
  })

  it("does not expand a single-platform stop", () => {
    const haje: StopIndexEntry = { ...entry("Háje", 100), platforms: [{ code: "A", stop: 1 }] }
    const r = searchStops([haje], "haje")
    expect(r).toHaveLength(1)
    expect(r[0].platform).toBeNull()
  })
```

- [ ] **Step 2: Run the matcher tests to verify they fail**

Run: `bunx vitest run packages/web/test/matcher.test.ts`
Expected: FAIL — `r[0].platform` is `undefined` (current `Candidate` has no `platform`).

- [ ] **Step 3: Rewrite the matcher with expansion**

Replace the contents of `packages/web/src/lib/matcher.ts` with:

```ts
import { fold, type StopIndexEntry } from "@app/contract"

export interface Candidate {
  readonly entry: StopIndexEntry
  readonly platform: string | null          // null = whole stop; else platform code
  readonly stops: ReadonlyArray<number> | null // selector scope for THIS candidate
  readonly score: number
}

interface Searchable {
  readonly entry: StopIndexEntry
  readonly platform: string | null
  readonly stops: ReadonlyArray<number> | null
  readonly norm: string
}

/** Grouped whole-stop row, plus one row per platform when the stop has several. */
const expand = (entry: StopIndexEntry): Array<Searchable> => {
  const grouped: Searchable = { entry, platform: null, stops: entry.stops, norm: entry.norm }
  if (entry.platforms.length <= 1) return [grouped]
  const perPlatform = entry.platforms.map((p) => ({
    entry,
    platform: p.code,
    stops: [p.stop],
    norm: entry.norm + " " + fold(p.code),
  }))
  return [grouped, ...perPlatform]
}

/**
 * exact prefix > word-boundary prefix > substring. Pure; instant at ~9k rows.
 * Sorting is on the searchable's norm (not entry.norm): the grouped row and its
 * platforms share one entry, so an entry-norm tiebreak could not order grouped
 * ahead of its platforms.
 */
export const searchStops = (
  index: ReadonlyArray<StopIndexEntry>,
  query: string,
  limit = 10,
): Array<Candidate> => {
  const q = fold(query.trim())
  if (q.length === 0) return []
  const out: Array<Searchable & { score: number }> = []
  for (const entry of index) {
    for (const s of expand(entry)) {
      let score = 0
      if (s.norm.startsWith(q)) score = 100
      else {
        const at = s.norm.indexOf(q)
        if (at > 0 && !/[a-z0-9]/.test(s.norm[at - 1])) score = 80
        else if (at > 0) score = 60
      }
      if (score > 0) out.push({ ...s, score })
    }
  }
  out.sort(
    (a, b) =>
      b.score - a.score ||
      a.norm.length - b.norm.length ||
      a.norm.localeCompare(b.norm),
  )
  return out
    .slice(0, limit)
    .map(({ entry, platform, stops, score }) => ({ entry, platform, stops, score }))
}
```

- [ ] **Step 4: Run the matcher tests to verify they pass**

Run: `bunx vitest run packages/web/test/matcher.test.ts`
Expected: PASS — including the pre-existing diacritics/ranking/recents tests (grouped rows behave exactly as before when `platforms` is empty or length 1).

- [ ] **Step 5: Verify `ranker.ts` needs no change**

Read `packages/web/src/lib/ranker.ts`. Confirm `rank` does `(c) => ({ ...c, score: ... })` and reads only `c.entry.node` and `c.score` — so the new `platform`/`stops` fields pass through untouched. No edit. (The matcher tests in Step 4 already exercise `rank` via the existing "boosts recents" test.)

- [ ] **Step 6: Wire the richer candidate into `App.tsx`**

In `packages/web/src/App.tsx`:

(a) Update imports — drop the now-unused `StopIndexEntry`, import the `Candidate` type:

```ts
import { selectorKey } from "@app/contract"
import { searchStops, type Candidate } from "./lib/matcher.ts"
```

(b) In the empty-query branch of the `results` memo, build full candidates and dedup on the candidate's selector:

```ts
    const candidates: Array<Candidate> =
      query.trim() === ""
        ? index.stops // empty box surfaces recents (spec 5.3)
            .filter((e) => recents.includes(String(e.node)))
            .map((entry) => ({ entry, platform: null, stops: entry.stops, score: 0 }))
        : searchStops(index.stops, query)
    return rank(candidates, recents).filter(
      (c) => !chosen.has(selectorKey({ node: c.entry.node, stops: c.stops })),
    )
```

(c) Replace `add` to accept a `Candidate` and use its selector + label:

```ts
  const add = (c: Candidate): void => {
    const name = c.platform === null ? c.entry.name : `${c.entry.name} ${c.platform}`
    update([...selection, { selector: { node: c.entry.node, stops: c.stops }, name }])
    pushRecent(c.entry.node)
    setQuery("")
  }
```

(d) Update the results list rendering — stable key on the candidate selector, a `· A` badge for platform rows, and a truncated platform list for the grouped row:

```tsx
        {results.length > 0 && (
          <ul className="results">
            {results.map((c) => (
              <li key={selectorKey({ node: c.entry.node, stops: c.stops })}>
                <button onClick={() => add(c)}>
                  {c.entry.name}
                  {c.platform !== null && <small className="platform"> · {c.platform}</small>}
                  {c.platform === null && c.entry.platforms.length > 1 && (
                    <small className="platforms">
                      {" ("}
                      {c.entry.platforms.slice(0, 4).map((p) => p.code).join(", ")}
                      {c.entry.platforms.length > 4 ? "…" : ""}
                      {")"}
                    </small>
                  )}
                  {c.entry.disambig !== null && <small> {c.entry.disambig}</small>}
                </button>
              </li>
            ))}
          </ul>
        )}
```

- [ ] **Step 7: Typecheck**

Run: `bun run typecheck`
Expected: PASS — 0 errors. (Confirms the `Candidate` type flows cleanly through `App.tsx` and `ranker.ts`, and the dropped `StopIndexEntry` import left no dangling reference.)

- [ ] **Step 8: Manual verification in dev**

`App.tsx` has no component-test harness in this repo (matching the existing pattern — all tests are logic-level). Verify by eye:

Run: `bunx vite dev packages/web` (per CLAUDE.md, use the Vite dev proxy for SPA work — local Worker static assets 500).
Then in the browser:
- Type `andel` → results show a grouped `Anděl (A, B, …)` row followed by `Anděl · A`, `Anděl · B`, … rows.
- Click `Anděl · A` → a board titled `Anděl A` appears showing only that platform's departures.
- Click the grouped `Anděl` row → a board spanning all platforms (as before).
- Type `andel a` → only the platform A row appears.

Stop the dev server when done.

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/lib/matcher.ts packages/web/test/matcher.test.ts packages/web/src/App.tsx
git commit -m "feat(web): platform-level stop search and selection

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Full gate

- [ ] **Step 1: Typecheck**

Run: `bun run typecheck`
Expected: PASS — 0 errors.

- [ ] **Step 2: Full unit suite**

Run: `bun run test`
Expected: PASS — all existing tests plus the new build, contract, and matcher tests.

- [ ] **Step 3: Integration suite (optional but recommended)**

Run: `bun run test:integration`
Expected: PASS — unchanged (this work does not touch the worker/gateway path). If the local Alchemy harness is flaky (known upstream issue per project notes), note it and rely on the unit gate.

- [ ] **Step 4: Confirm the tree is clean**

Run: `git status --short`
Expected: empty — all changes committed across Tasks 1–3.

---

## Notes / known trade-offs

- **Result limit vs. expansion.** `searchStops` keeps its default `limit = 10` over the *combined* grouped+platform rows. A 9-platform hub (e.g. Anděl) can fill the list for a short query like `andel` and crowd out sibling stops (e.g. Andělka). This is intentional for v1 (the user is hunting a platform). If sibling discoverability matters, raising the limit or capping platforms-per-stop in the result list is a one-line follow-up — left for the card-layout prototype phase.
- **Grouped card layout is out of scope.** Sectioning, per-departure platform badges, and filter chips are deferred to a clickable prototype. The data this needs is already in place: `entry.platforms` on the index and `platform` on every live `Departure`.
