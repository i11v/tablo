# Code audit — improvement suggestions

Audit date: 2026-07-11. Baseline at audit time: `bun run typecheck` clean
(the two `TS11` language-service notices on `packages/worker/src/do/gateway.ts`
and `do/session.ts` are intentional — the Alchemy DO namespace API uses a
two-phase init where the outer generator deliberately returns an inner
Effect), `bun run lint` clean, all 82 unit tests passing.

## How to use this document

Each suggestion below is self-contained: it states the problem, quotes the
offending code, and gives a concrete fix plus acceptance criteria. Pick one
suggestion, implement exactly what it describes, and verify with the listed
commands. Don't combine unrelated suggestions in one PR.

Conventions:

- **ID**: `WKR` = `packages/worker`, `WEB` = `packages/web`, `TLG` =
  tooling/scripts/CI/contract.
- **Effort**: S = under an hour, M = a few hours.
- Line numbers refer to the tree at commit `1881dda`; re-locate by the quoted
  code if the file has drifted.
- After any change run: `bun run typecheck && bun run lint && bun run test`.
  For CI/workflow changes there is nothing to run locally; keep the YAML diff
  minimal.

## Priority overview

Fix these first (real user-visible bugs or safety mechanisms that don't work):

| ID | Title | Effort |
|----|-------|--------|
| WEB-01 | Whole-stop selection of a multi-name node hides departures | S |
| WEB-02 | Unvalidated `?s=` URL can wedge the WebSocket feed | S |
| TLG-01 | Build-time schema check can ship a client-breaking stop index | S |
| WKR-01 | Integration test asserts a status the worker no longer returns; suite absent from CI | S |
| WKR-02 | ClientSession DO storage leaks on abnormal disconnect | S |
| TLG-03 | GTFS download clobbers its own fallback cache before validation | M |

Everything else is ordered by area below.

---

## packages/worker

### WKR-01 — Integration test asserts 400 for a request that now gets 426; integration suite not in CI

**Type:** test-correctness · **Effort:** S

`packages/worker/test-integration/stack.test.ts:40-43`:

```ts
test("ws rejects a missing session id", async () => {
  const res = await fetch(baseUrl + "/api/ws")
  expect(res.status).toBe(400)
})
```

`packages/worker/src/index.ts:104-112` checks the `Upgrade` header **before**
the session id and answers 426 for plain GETs. A plain `fetch` sends no
`Upgrade` header, so this test fails today. Nobody noticed because no
workflow runs `test:integration` (grep `.github/workflows/` — no match).

**Fix:**
1. Change the assertion to `expect(res.status).toBe(426)` and rename the test
   to "ws rejects a non-upgrade request".
2. Add a real missing-session test using the `ws` package (already a
   dependency, used in the same file), which performs the upgrade handshake:
   ```ts
   test("ws rejects a missing session id", async () => {
     const wsUrl = baseUrl.replace(/^http/, "ws") + "/api/ws"
     const err = await new Promise<Error>((resolve) => {
       const ws = new WebSocket(wsUrl)
       ws.on("error", resolve)
     })
     expect(String(err)).toContain("400")
   })
   ```
3. Add a `bun run test:integration` step to `.github/workflows/pr-preview.yml`
   (the suite is designed to pass without a Golemio token — it exercises the
   degraded path).

**Acceptance:** `bun run test:integration` passes locally; CI runs it.

### WKR-02 — ClientSession DO storage leaks (retained + billed forever) on abnormal disconnect

**Type:** resource leak · **Effort:** S

`packages/worker/src/do/session.ts`. Cleanup (`deleteAll`) only happens in
`webSocketClose`. Abnormal disconnects (network drop, tab kill) arrive as
`webSocketError`, which the Alchemy DO bridge does not implement — so
`webSocketClose` never runs and the stored `"selectors"` key retains (and
bills) the DO forever. The file's own comment (lines 105-109) explains why
stored data must not persist.

The alarm-driven `poll` already observes the leaked state but keeps it
(session.ts:33-39):

```ts
if (selectors.length === 0 || sockets.length === 0) {
  yield* state.storage.deleteAlarm()
  return
}
```

Two more variants: `Unsubscribe` does `storage.put(STORAGE_KEY, [])` (line
76) — a stored `[]` is still stored data, and no alarm remains to notice a
later abnormal drop; a `Subscribe` with `selectors: []` (valid per schema on
this public endpoint) hits the same hole.

**Fix:**
```ts
// in poll():
if (selectors.length === 0 || sockets.length === 0) {
  yield* state.storage.deleteAlarm()
  if (sockets.length === 0) yield* state.storage.deleteAll() // no clients left: release the DO
  return
}

// in the Unsubscribe case — and treat Subscribe with 0 selectors identically:
yield* state.storage.delete(STORAGE_KEY) // not put([]) — stored [] still retains the DO
yield* state.storage.deleteAlarm()
```

**Acceptance:** unit or integration coverage that after unsubscribe (or a
poll that finds zero sockets) the DO has no stored keys and no alarm.
Existing tests stay green.

### WKR-03 — `cacheKey` is not order-independent for same-node selectors

**Type:** performance / maintainability · **Effort:** S

`packages/worker/src/gateway/service.ts:38-47` sorts selectors by `node`
only:

```ts
.sort((a, b) => a.node - b.node),
```

`sort` is stable, so `[{node:1,stops:[2]},{node:1,stops:[1]}]` and its
reversal produce different keys for the same set (two platform-boards on one
node is realistic). Result: duplicate cache/`lastGood` entries and duplicate
upstream Golemio calls; the stale-fallback for one ordering misses data
fetched under the other. Duplicated selectors are also not collapsed.

**Fix:** sort by the full canonical serialization:

```ts
const cacheKey = (selectors: ReadonlyArray<StopSelector>): string => {
  const canon = selectors
    .map((s) =>
      JSON.stringify({
        node: s.node,
        stops: s.stops === null ? null : [...s.stops].sort((a, b) => a - b),
      }),
    )
    .sort()
  return `[${canon.join(",")}]`
}
```

Still valid `JSON.parse` input for `lookup`; board order doesn't matter to
the web client (it indexes boards by key into a `Map`).

**Acceptance:** new test in `packages/worker/test/gateway.test.ts`: subscribe
with a permuted same-node selector list and assert the fake upstream is
called once (existing tests only coalesce byte-identical arrays).

### WKR-04 — Static-asset fallback buffers whole bodies and drops response headers

**Type:** robustness · **Effort:** S

`packages/worker/src/index.ts:139-151` reads the asset response into a
`Uint8Array` and re-emits it keeping only `content-type` — dropping
`cache-control`, `etag`, `content-encoding`, so dev-mode caching diverges
from production. The `/data/` branch a few lines up already does it right:
`return HttpServerResponse.fromWeb(res)` (line 133).

**Fix:** replace the buffering block with `return HttpServerResponse.fromWeb(res)`.

**Acceptance:** `bun run test:integration` passes (it drives this exact
fallback path on local workerd).

### WKR-05 — Gateway mixes time sources; cooldown deadline uses a stale clock read

**Type:** robustness / testability · **Effort:** S

`packages/worker/src/gateway/service.ts`: `now` is read (line 66) before the
rate-limiter delay and the HTTP round-trip, then used for the 429 cooldown
deadline (`Ref.set(cooldownUntil, now + RATE_LIMIT_COOLDOWN_MS)`) — a 429
arriving near the 5s shed timeout yields an effective ~25s cooldown instead
of 30s. Separately, `generatedAt: new Date().toISOString()` (lines 85 and
121) bypasses `Clock`, so `TestClock`-driven tests can't assert on it.

**Fix:** in the `tapError`, re-read the clock:
`Clock.currentTimeMillis.pipe(Effect.flatMap((t) => Ref.set(cooldownUntil, t + RATE_LIMIT_COOLDOWN_MS)))`;
derive `generatedAt` as `new Date(yield* Clock.currentTimeMillis).toISOString()`
in both places.

**Acceptance:** existing gateway tests green; optionally a `TestClock` test
asserting the cooldown window measures from failure time.

### WKR-06 — `Effect.catchIf` with an always-true predicate; defects escape the "never fails" contract

**Type:** maintainability · **Effort:** S

`packages/worker/src/gateway/service.ts:107-127`:

```ts
Effect.catchIf(
  (_): _ is typeof _ => true,
  (error) => ...
```

This is `catchAll` in disguise, and neither form catches defects — a defect
inside `lookup` (Effect v4 `Cache` stores failure exits and replays them for
the TTL) would violate the documented `/** Never fails … */` contract at
line 52. Downstream survives only because `ClientSession.poll` wraps the RPC
in `catchCause`.

**Fix:** replace with `Effect.catchAllCause((cause) => ...)` and derive the
degraded-response `reason` from the cause (e.g. `Cause.squash(cause)`, then
the existing `_tag` extraction). Behavior for typed errors is unchanged.
Consult `effect-solutions show error-handling` before writing the change.

**Acceptance:** existing gateway tests green; the degraded path still reports
the same `reason` strings for 429/upstream/schema errors.

### WKR-07 — Zero unit coverage for ClientSession, the most concurrency-sensitive code in the package

**Type:** test-coverage · **Effort:** M

`packages/worker/src/do/session.ts` contains the arm-alarm-before-RPC
ordering, the drop-stale-frame check after the RPC interleave, alarm
teardown, and last-socket storage release — exercised only by one happy-path
integration test.

**Fix:** unit-test the DO body without workerd by faking its two
dependencies: a fake `Cloudflare.DurableObjectState` (in-memory `Map`
storage, `setAlarm`/`deleteAlarm`/`deleteAll` recorders, controllable
`getWebSockets()` with `send` spies) provided via
`Layer.succeed(Cloudflare.DurableObjectState, fake)`, and a fake
`GolemioGateway` whose `getBoards` blocks on a `Deferred` so tests can mutate
storage mid-RPC. Priority scenarios:

1. selectors change during in-flight `getBoards` → the stale frame is not broadcast;
2. poll with no sockets → alarm deleted (and storage cleared, after WKR-02);
3. Subscribe → alarm armed before the RPC resolves;
4. failing RPC → alarm remains armed;
5. close of last socket → `deleteAlarm` + `deleteAll`; close of non-last socket → storage untouched.

**Acceptance:** new `packages/worker/test/session.test.ts` covering the five
scenarios; all green.

### WKR-08 — GolemioClient tests skip the timeout and schema-mismatch paths

**Type:** test-coverage · **Effort:** S

`packages/worker/test/client.test.ts` covers 200/429/401 but not the declared
10s timeout (`GolemioUpstreamError({ status: 0, detail: "timeout" })`,
client.ts:46-49) or a 2xx body that fails schema decode (client.ts:64).

**Fix:** add two `it.effect` cases reusing the existing `mockHttp`/`layerWith`
helpers: (a) a client that never responds, driven by
`TestClock.adjust("10 seconds")`, asserting the timeout failure; (b)
`layerWith(200, { unexpected: true })`, asserting the exit contains
`SchemaError` — pinning that decode failures are not swallowed into
`GolemioUpstreamError`.

**Acceptance:** both tests green alongside the existing suite.

---

## packages/web

### WEB-01 — Whole-stop selection of a multi-name node force-pins one platform and hides the rest

**Type:** correctness · **Effort:** S (guard) + M (byNode fix, optional)

`packages/web/src/App.tsx:75-81` treats **any** non-null `stops` as a
platform pin:

```ts
if (sel.selector.stops !== null && e !== undefined) {
  const code = e.platforms.find((p) => sel.selector.stops!.includes(p.stop))?.code ?? null
  if (code !== null && departures.some((d) => platformKey(d) === code)) {
    pin = code
```

But the grouped "whole stop" search row for a multi-name node forwards
`entry.stops` as a non-null list (see the matcher test "grouped row forwards
a multi-name node's stop scope (not null)"). `find` returns the first
platform, so the user who added the whole stop sees a pin badge, no filter
bar (`StopCard.tsx:127,150-152` force-filters when pinned), and the other
platforms' departures silently hidden.

**Fix:** only pin when the selection scopes exactly one platform:

```ts
if (sel.selector.stops !== null && sel.selector.stops.length === 1 && e !== undefined) {
```

Related latent issue: `byNode` (App.tsx:38-41) is
`new Map(stops.map((e) => [e.node, e]))` — multi-name nodes have several
index entries per node, so later entries overwrite earlier ones and the
pin/name lookup may use the wrong name's entry. Prefer the entry whose
`platforms` contains the selected stop id (or build `Map<number, StopIndexEntry[]>`).

**Acceptance:** extract the pin derivation into a pure function (e.g.
`lib/pin.ts: pinFor(selector, entry, departures)`) and unit-test: single-
platform selection → pin; multi-platform whole selection → no pin.

### WEB-02 — `decodeSelection` accepts selections the wire protocol rejects; a hand-edited `?s=` URL wedges the feed

**Type:** correctness / robustness · **Effort:** S

`packages/web/src/lib/url.ts:32-58` validates only `/^\d+$/` per number — no
cap on selector count, stop count, or magnitude. The contract enforces
`MAX_SELECTORS = 20`, `MAX_PLATFORMS_PER_SELECTOR = 16`, and AswId ∈
1..999999 (`packages/contract/src/domain.ts:14-27`). `loadSelection()` feeds
URL input straight into the store, and `useDepartures` calls
`encodeClient(...)` (= `Schema.encodeUnknownSync(ClientMessageJson)`) inside
`ws.onopen` and the subscribe effect — with out-of-bounds input it throws,
leaving the board stuck on "connecting…" or unmounting the tree.

**Fix:** enforce the bounds in `decodeSelection`:

```ts
for (const part of raw.split(";")) {
  if (out.length >= MAX_SELECTORS) break
  // ... existing parsing ...
  const [node, ...stops] = nums.map(Number)
  const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= 999_999
  if (!valid(node) || stops.length > MAX_PLATFORMS_PER_SELECTOR || !stops.every(valid)) continue
```

Import `MAX_SELECTORS` / `MAX_PLATFORMS_PER_SELECTOR` from `@app/contract`;
consider exporting the AswId bounds from the contract too instead of
hard-coding `999_999`.

**Acceptance:** new cases in `packages/web/test/url.test.ts`: 21+ selectors
truncated, 17-stop selector skipped, node `0` and 7-digit node skipped.

### WEB-03 — Duplicate React keys in search results for multi-name nodes

**Type:** correctness · **Effort:** S

`packages/web/src/components/search.tsx:271-272`:

```tsx
{entries.map((e) => (
  <ResultCard key={e.node} entry={e} {...hooks} />
))}
```

The recents path deliberately keeps several entries per node
(`search.tsx:94-97` — "a node can have several platform-scoped entries —
keep them all") and `nearestStops` can too, so `key={e.node}` collides and
React drops/misrenders a card.

**Fix:** `key={`${e.node}:${e.norm}`}` (node + normalized name is the unique
pair in `StopIndexEntry`).

**Acceptance:** no key warnings when recents contain a multi-name node; lint
and tests green.

### WEB-04 — `formatClock` documents Prague wall-clock but formats in device-local time

**Type:** correctness · **Effort:** S

`packages/web/src/lib/time.ts:1-3`:

```ts
/** Format an epoch-ms instant as a Prague wall-clock "HH:MM" (24h). */
export const formatClock = (ms: number): string =>
  new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
```

No `timeZone` option → the header clock and every absolute arrival time
render in the device's timezone (wrong for a phone still set to another
zone). Also constructs a fresh formatter per call, once per visible row per
second.

**Fix:**

```ts
const fmt = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Prague",
})
export const formatClock = (ms: number): string => fmt.format(ms)
```

**Acceptance:** a test pinning
`formatClock(Date.parse("2026-06-29T13:29:00+02:00")) === "13:29"`
(independent of the runner's `TZ`).

### WEB-05 — Unparsable timestamps render literal "NaN" rows

**Type:** robustness · **Effort:** S

`packages/web/src/lib/departureVM.ts:20-33`: if `Date.parse` returns `NaN`,
`NaN < -GONE_MS` is false so the row is kept; `Math.max(0, NaN)` is `NaN`, so
the count renders "NaN" and `sortKey: NaN` corrupts the sort. The contract
only promises timestamps are "passed through from Golemio".

**Fix:** after computing `t`, add `if (Number.isNaN(t)) return null`.

**Acceptance:** a test in `packages/web/test/departureVM.test.ts` with a
garbage timestamp asserting the row is dropped.

### WEB-06 — Every geolocation callback creates new state: 9k-stop recomputes and redundant WS re-subscribes

**Type:** performance · **Effort:** S–M

`packages/web/src/store.ts:39-47`: `watchPosition` fires repeatedly (jitter
included) and each call installs a new object, so every subscriber
re-renders — App recomputes the nearest-stop label (haversine over ~9k
stops, memo keyed on `geo` identity, App.tsx:50-62), and on `/search` the
`origin` memo → new `entries` → new `liveSelectors` → the subscribe effect
in `useDepartures` sends a fresh `Subscribe` frame for an identical selector
set.

**Fix (two parts):**
1. In `startGeoWatch`, skip no-op updates: keep the previous fix when
   `haversineMetres(prev.lat, prev.lon, lat, lon) < 25`.
2. In `useDepartures`, keep a `lastSentRef: string` of the encoded frame and
   skip `ws.send` when the newly encoded message equals it (reset the ref in
   `onopen` after the explicit subscribe).

**Acceptance:** manually verify (or unit-test the ref logic via the exported
state machine) that identical selector sets don't emit repeated Subscribe
frames.

### WEB-07 — Search live preview re-subscribes on every keystroke

**Type:** performance / upstream load · **Effort:** M

`packages/web/src/components/search.tsx:337-345`: `liveSelectors` is derived
from `entries`, which changes per keystroke — typing "andel" sends up to 5
Subscribe frames, each subscribing up to 20 whole-node boards that the worker
resolves against Golemio. (WEB-06's identity guard doesn't help: the node
sets genuinely differ per keystroke.)

**Fix:** debounce only the subscription input, keeping the rendered result
list instant: add a small trailing-edge `useDebounced(value, 300)` hook, feed
`debouncedEntries` into the `liveSelectors` memo.

**Acceptance:** typing a 5-letter query results in at most 1–2 Subscribe
frames (verifiable via devtools WS inspector or a unit test on the hook).

### WEB-08 — No fast reconnect on `online`/`visibilitychange`; stale "live" board after device sleep

**Type:** robustness · **Effort:** M

`packages/web/src/hooks/useDepartures.ts:77-137`: reconnection is timer-only
(backoff up to 30s). After a network outage the user stares at
"reconnecting…" for the rest of the delay; after device sleep a half-dead
socket may not fire `onclose` for a long time, so the status stays "live"
while boards go stale and rows silently age out.

**Fix:** inside the connect effect, register `online` (window) and
`visibilitychange` (document) listeners cleaned up in the teardown:

```ts
const wake = (): void => {
  if (closed || document.visibilityState === "hidden") return
  const ws = wsRef.current
  if (timer !== undefined) { clearTimeout(timer); timer = undefined; connect() } // skip backoff
  else if (ws !== null && ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING) connect()
  else if (ws !== null && ws.readyState === WebSocket.OPEN) ws.close() // suspected-dead probe → onclose → reconnect
}
```

For the visible-with-open-socket case, only force-close when no message has
arrived within some window (track `lastMessageAt` in a ref) to avoid killing
healthy sockets on every tab switch.

**Acceptance:** simulate offline → online in devtools; reconnect happens
immediately rather than after the backoff.

### WEB-09 — Adding a stop at the 20-stop cap is silently dropped and the search panel still closes

**Type:** UX / robustness · **Effort:** S

`packages/web/src/store.ts:64-70` returns early when `addSelection` no-ops at
the cap; `search.tsx:313-318` closes the panel unconditionally. At the cap,
the tap does nothing and gives no feedback.

**Fix:** make the store's `add` return a boolean (whether it added); in the
search panel only `onClose()` on `true`; optionally show a one-line "board is
full (20 stops)" notice keyed off `chosen.size >= MAX_SELECTORS`.

**Acceptance:** at 20 selections, tapping another stop keeps the panel open
(and shows the notice if implemented); below the cap behavior is unchanged.

### WEB-10 — Reachability tier conveyed by color alone on non-lead rows

**Type:** accessibility · **Effort:** S

The lead row gets a text chip (`CATCH`/`RUN`/`MISSED`, StopCard.tsx:50-56),
but every other row expresses the tier only through the `Count` color
(`primitives.tsx:19-49`). Colorblind and screen-reader users can't
distinguish a missable departure from a catchable one.

**Fix:** thread the tier (already computed in `Row`) into `Count` and add a
visually-hidden label:
`{tier !== "neutral" && <span className="sr-only">{TIER[tier].label}</span>}`
(Tailwind v4 ships `sr-only`).

**Acceptance:** screen-reader output includes the tier label; visual
rendering unchanged.

### WEB-11 — Board has no semantic structure (no headings, no list semantics)

**Type:** accessibility · **Effort:** S

Stop names are plain `<span>`s and cards/rows are nested `<div>`s
(`App.tsx:104-133`, `StopCard.tsx:169-183`) — a screen reader gets an
undifferentiated, second-by-second-updating text stream.

**Fix (non-visual):** render the stop name as `<h2>` with the existing
classes; give each board grid `role="list"` and each card wrapper
`role="listitem"`; add `aria-hidden` to the decorative `⌖` glyph in
`LocationChip` (`chrome.tsx:63-65`).

**Acceptance:** DOM shows headings/list roles; visual snapshot unchanged.

### WEB-12 — Missing tests for `stop.ts` and `storage.ts`

**Type:** test-coverage · **Effort:** M

Two tricky pure modules have zero coverage:

- `packages/web/src/lib/stop.ts:20-49` — `platformKey`/`platformsOf`:
  metro-collapse to `"Metro"`, blank/`"–"` platforms mapping to `"?"`,
  destination list capped at 3 with dedupe, per-key counts. This drives the
  filter bar in StopCard.
- `packages/web/src/lib/storage.ts:30-58` — `loadSelection` URL-beats-
  localStorage precedence (including `?s=` present-but-empty), `pushRecent`
  most-recent-first dedupe and cap at 8, `loadRecents` junk tolerance.
  Testable in vitest by stubbing `globalThis.localStorage` and `location`.

**Acceptance:** new `test/stop.test.ts` and `test/storage.test.ts` covering
the above; all green.

### WEB-13 — Dead code: `tierColor` export and `filterable` prop

**Type:** maintainability · **Effort:** S

- `packages/web/src/lib/tier.ts:19` — `export const tierColor` has no usages
  (every consumer reads `TIER[tier].color` directly). Delete it.
- `packages/web/src/components/StopCard.tsx:117` — the `filterable = true`
  prop is never passed by any caller. Delete the prop and simplify
  `hasFilter` accordingly (line 128).

**Acceptance:** typecheck, lint, tests green; grep confirms no references.

---

## Contract, scripts, CI, tooling

### TLG-01 — Non-finite/empty coordinates defeat the build-time schema check and can ship a client-breaking index

**Type:** correctness · **Effort:** S

`scripts/lib/build.ts:56-57,95-96` converts CSV fields with bare
`Number(...)`. Two failure modes:

- `stop_lat: ""` → `Number("")` is `0`, silently skewing the centroid toward
  (0, 0).
- `stop_lat: "garbage"` → `NaN` propagates through `mean()`/`.toFixed(5)`.
  The "fail loudly" guard in `scripts/build-stop-index.ts:43`
  (`Schema.decodeUnknownSync(StopIndexV1)(index)`) passes — `Schema.Number`
  in effect 4.0.0-beta.78 accepts `NaN` — but `JSON.stringify(NaN)` emits
  `null`, so the deployed artifact contains `"lat":null`, which the client's
  decode in `useStopIndex.ts` rejects at runtime. Broken app through green CI.

**Fix (all four parts):**
1. In `packages/contract/src/stop-index.ts:15-16`, constrain coordinates:
   `lat: Schema.Number.check(Schema.isFinite())` (same for `lon`).
   `Schema.isFinite` exists in this effect version and rejects `NaN`.
2. In `build-stop-index.ts`, validate the *serialized* form: move the check
   after `const json = JSON.stringify(index)` and decode `JSON.parse(json)`.
3. In `build.ts`, add a strict number helper that throws on `""` and
   non-finite values (or skips the row) and use it for lat/lon.
4. Tests in `scripts/test/build.test.ts` with `stop_lat: ""` and `"x"`.

**Acceptance:** the two new tests fail before the fix and pass after;
`bun run build:index` still succeeds against the real feed.

### TLG-02 — Multi-name node with an ASW-id-less name produces a `stops: []` selector that matches nothing

**Type:** correctness edge case · **Effort:** S

`scripts/lib/build.ts:94`: rows can pass the filter with `asw_node_id` set
but `asw_stop_id` empty (line 51 only adds non-empty ids to `g.stops`). If a
node has two names and one name's rows all lack `asw_stop_id`, that entry
gets `stops: []` — a platform-scoped selector subscribing to zero platforms:
dead weight in search, permanently empty board if picked.

**Fix:** in the `entries` mapping, when the group would be platform-scoped
(`namesPerNode.get(g.node)!.size > 1`) but `g.stops.size === 0`, skip the
entry (return null and filter) — or deliberately emit `stops: null`; pick one
and document it. Add a test reproducing the case (two names on one node, one
name with empty `asw_stop_id`).

**Acceptance:** new test green; no `"stops":[]` in the built index.

### TLG-03 — A corrupt-but-200 GTFS download clobbers the last-good cached zip; fetch has no timeout

**Type:** robustness / CI reliability · **Effort:** M

`scripts/build-stop-index.ts:19-39` writes the response over `CACHE_ZIP`
before any validation. The cache exists so "a data.pid.cz outage can't block
a deploy" — but a 200 with a truncated/corrupt body (CDN error page,
mid-transfer reset) overwrites the good cache first, then `unzip` fails with
no fallback left. `fetch` also has no timeout, so a hung connection eats the
job timeout.

**Fix:** download to a temp name, validate, then promote:

```ts
const res = await fetch(GTFS_URL, { signal: AbortSignal.timeout(120_000) }).catch(() => null)
if (res !== null && res.ok) {
  const fresh = CACHE_DIR + "/PID_GTFS.zip.download"
  await mkdir(CACHE_DIR, { recursive: true })
  try {
    await Bun.write(fresh, res)
    await $`unzip -t ${fresh}`.quiet() // validate before promoting
    await rename(fresh, CACHE_ZIP)     // node:fs/promises
  } catch (e) {
    await rm(fresh, { force: true })
    if (!existsSync(CACHE_ZIP)) throw e
    console.warn("GTFS download corrupt — falling back to cached zip")
  }
} // keep the existing cached/throw branches for the !ok/null case
```

**Acceptance:** simulate by pointing `GTFS_URL` at a non-zip URL with a
populated cache: the build completes from cache with a warning.

### TLG-04 — Fork PRs run the preview workflow and fail late with confusing errors

**Type:** CI reliability · **Effort:** S

`.github/workflows/pr-preview.yml:15-16`: the workflow triggers on plain
`pull_request`; for fork PRs `secrets.*` are empty and `GITHUB_TOKEN` is
read-only, so the run burns the full build then fails on Cloudflare auth (the
`CF_WORKERS_SUBDOMAIN` guard doesn't catch this — repo *variables* are
available to fork PRs).

**Fix:** gate both jobs:

```yaml
preview:
  if: github.event.action != 'closed' && github.event.pull_request.head.repo.fork == false
cleanup:
  if: github.event.action == 'closed' && github.event.pull_request.head.repo.fork == false
```

**Acceptance:** YAML valid; same-repo PRs unaffected.

### TLG-05 — Third-party actions pinned to mutable tags, not SHAs

**Type:** security (supply chain) · **Effort:** S

`deploy.yml:20-21,29` and `pr-preview.yml:23-24,32,71,99-100` use
`actions/checkout@v5`, `oven-sh/setup-bun@v2`, `actions/cache@v5`,
`actions/github-script@v8` — mutable tags in workflows that carry
`CLOUDFLARE_API_TOKEN` / `GOLEMIO_API_TOKEN`.

**Fix:** pin every `uses:` to a full commit SHA with the tag as a trailing
comment (resolve current SHAs at implementation time, e.g.
`https://api.github.com/repos/<owner>/<repo>/git/ref/tags/<tag>`). Add
`persist-credentials: false` to the checkout steps — nothing in these jobs
pushes.

**Acceptance:** both workflows still pass on a test PR.

### TLG-06 — Check/build pipeline and smoke test duplicated across the two workflows

**Type:** maintainability · **Effort:** M

`deploy.yml:20-46` and `pr-preview.yml:23-46` are byte-identical for ~27
lines (setup-bun → install → lint → fmt:check → typecheck → test → GTFS cache
→ build:index → build:web → verify:pwa → subdomain guard), and the two
15-line smoke-test scripts differ only in `URL`/`EXPECTED`.

**Fix:** extract a composite action `.github/actions/build-and-check/action.yml`
with the shared steps (making `bun-version` a single source of truth), and a
second small composite for the smoke test taking `url` and `expected` inputs.
Each workflow becomes checkout + `uses: ./.github/actions/build-and-check` +
deploy + smoke.

**Acceptance:** both workflows green on a test PR; no behavior change.

### TLG-07 — `bun install` runs uncached on every CI job

**Type:** CI speed · **Effort:** S

`oven-sh/setup-bun@v2` doesn't cache the package download cache, so all three
jobs re-download the full dependency set every run.

**Fix:** before each `bun install --frozen-lockfile`:

```yaml
- uses: actions/cache@v5
  with:
    path: ~/.bun/install/cache
    key: bun-${{ runner.os }}-${{ hashFiles('bun.lock') }}
    restore-keys: bun-${{ runner.os }}-
```

(If TLG-06 lands first, this goes in the composite action once.)

**Acceptance:** second CI run shows a cache hit and a faster install step.

### TLG-08 — `parseCsv` does not strip a UTF-8 BOM

**Type:** robustness · **Effort:** S

`scripts/lib/csv.ts:7-12`: `parseCsv("﻿stop_id,...")` returns
`"﻿stop_id"` as the first header. The GTFS spec explicitly permits a
BOM; today this is masked only because `stop_id` (the first column) is never
looked up by name. A feed reorder plus BOM breaks `need("stop_name")`.

**Fix:** first line of `parseCsv`:
`if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)` (use a local
variable), plus a one-line test in `scripts/test/csv.test.ts`.

**Acceptance:** new test green.

### TLG-09 — Stale "Preview deployed" comment survives PR close/merge

**Type:** UX · **Effort:** S

`pr-preview.yml:94-109`: the `cleanup` job destroys the preview worker but
leaves the sticky `<!-- tablo-preview -->` comment advertising a now-dead
URL.

**Fix:** give `cleanup` `permissions: { contents: read, pull-requests: write }`
and append an `actions/github-script` step that finds the marker comment
(same lookup as the deploy job) and rewrites it to
`${marker}\n🧹 Preview destroyed (PR closed).` — no-op if not found.

**Acceptance:** closing a test PR updates the comment.

### TLG-10 — Tooling/test deps declared as production `dependencies`; `@effect/vitest` undeclared by its consumer

**Type:** maintainability · **Effort:** S

Root `package.json:22-28`: `@effect/platform-node` is imported nowhere in
first-party code (it satisfies alchemy's optional peer — deploy tooling) and
`ws` is imported only by `packages/worker/test-integration/stack.test.ts` —
both belong in `devDependencies`. Conversely `packages/worker` tests import
`@effect/vitest` but `packages/worker/package.json` doesn't declare it (works
via hoisting; breaks under isolated linkers).

**Fix:** move `@effect/platform-node` and `ws` to root `devDependencies`; add
`"@effect/vitest": "4.0.0-beta.78"` (and optionally `ws`/`@types/ws`) to
`packages/worker/package.json` devDependencies. Run `bun install` to refresh
the lockfile.

**Acceptance:** install, typecheck, tests, and `bun run deploy` dry paths
unaffected.

### TLG-11 — `ws-probe.ts` hangs 40s on early close; hardcoded URL

**Type:** dev tooling · **Effort:** S

`scripts/ws-probe.ts`: no `onclose` handler — if the server accepts then
closes before 2 messages arrive, the probe waits out the full 40s timeout.
URL hardcoded to `ws://localhost:1337`.

**Fix:** read the base from `process.env.TABLO_WS_URL ?? "ws://localhost:1337"`;
add `ws.onclose = (e) => { if (count < 2) { console.error(...); process.exit(1) } }`.

**Acceptance:** probe against a closed port fails fast.

### TLG-12 — Lefthook pre-commit checks the working tree, not the staged content

**Type:** hook correctness · **Effort:** S

`lefthook.yml:6-10` runs `bun run lint` / `bun run fmt:check` repo-wide: a
commit of file A is blocked by lint errors in unrelated dirty file B, and a
partially staged file is checked in its working-tree form (CI checks the
commit; the hook checks the tree).

**Fix:** scope to staged files:

```yaml
- name: lint
  glob: "*.{ts,tsx}"
  run: bunx oxlint {staged_files}
- name: format
  glob: "*.{ts,tsx}"
  run: bunx oxfmt --check {staged_files}
```

**Acceptance:** committing a clean file with an unrelated dirty file present
succeeds; committing a lint-broken staged file fails.

---

## Explicitly checked and found sound (no action needed)

To save the next auditor time, these were examined and deliberately not
flagged:

- **Worker:** the poll/Subscribe/Unsubscribe interleaving around the gateway
  RPC (DO input gates + post-RPC re-read) handles every constructible
  interleave; Effect v4 `Cache` caching failures for the 5s TTL matches the
  intended degraded-response behavior; timestamp handling is consistent
  across normalize.ts and the contract.
- **Web:** the reconnect backoff/jitter/stable-reset/unsubscribe-on-reconnect
  design is solid (WEB-08 is the one gap).
- **Tooling:** preview-deploy concurrency groups correctly serialize
  overlapping runs; the CSV parser core (CRLF, escaped quotes, embedded
  newlines, trailing rows) is correct and tested; contract/consumer shapes
  are in sync; the alchemy stage-mismatch guard is sound; the GTFS
  actions/cache key design is intentional; excluding `generatedAt` from the
  index hash is correct for the hash-immutable URL design.
