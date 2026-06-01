# tablo — Prague Departures SPA — Design

**Date:** 2026-06-01
**Status:** Approved design (pre-implementation)
**Updated:** 2026-06-01 — switched the stack to **Effect v4 (beta)**; all module
references now point at the v4 `effect/unstable/*` surface (no `@effect/platform`).

## 1. Summary

`tablo` is a single-page web app that shows live, ticking countdowns to the next
trams, buses, and metros at one or more user-selected Prague stops — a personal
"departure board" (tabule) for the stops you care about. Data comes from the
Golemio API (Prague public transport / PID). The backend is a single Cloudflare
Worker (static assets + API + Durable Objects), deployed with Alchemy V2, with
all server logic written in **Effect v4 (beta)** — chosen for a slimmer,
tree-shakeable bundle; the whole stack lives in the single `effect` package.

### Goals
- Pick multiple stops; see a live board per stop with the next departures.
- Countdowns tick every second; underlying data refreshes via server push.
- Personal use, zero friction: no accounts, no login.
- A global rate limiter protects the Golemio API key from day one, so a traffic
  spike degrades gracefully instead of burning the quota.

### Non-goals (v1)
- User accounts, server-side persistence of selections, cross-device sync.
- Journey planning / routing between stops.
- Geo-proximity ranking and mode icons in search (deferred, but the
  architecture is built so they drop in without rework — see §5.5).

## 2. Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Effect version | **v4 beta** (`effect@4.0.0-beta.74`) | Slimmer/tree-shakeable; single `effect` package; no `@effect/platform`. Beta is acceptable for a personal project. |
| Persistence | Client-side only (`localStorage` + URL), no accounts, no DB, no auth | Simplest; YAGNI. Selections are shareable via URL. |
| Deploy topology | Single Worker: static assets + `/api/*` + Durable Objects | Same origin (no CORS), one Alchemy deploy artifact, one repo. |
| Frontend | React (Vite) + Effect end-to-end via v4 `HttpApi` (`effect/unstable/httpapi`) | Contract defined once; typed client derived for the browser; shared `Schema`; zero drift. |
| Freshness | Server push over WebSocket (Hibernation API) | Low-latency, minimal upstream calls; DO hibernates while idle sockets stay open. |
| DO topology | One DO per client session | Simple routing; one batched upstream call covers all of a client's stops. |
| Rate limiting | Singleton `GolemioGateway` DO with v4 store-backed `RateLimiter` (`effect/unstable/persistence`) | Global choke point that owns the token and the quota; graceful shedding; clean evolution path (swap the store layer). |
| Scale | Personal, but rate limiter baked in | "Just me," designed to not fall over if it blows up. |
| Stop search | Client-side, over a bundled GTFS-derived index | Golemio has no fuzzy search; SPA-appropriate; instant, zero backend cost. |
| Departures endpoint | Prefer `/v2/public/departureboards` | Client-optimized variant; same auth + caching semantics. |

## 3. Topology

```
Browser (React SPA)
  │  ① HTTPS: load app shell + lazy-load stop index (static assets)
  │  ② WSS: /api/ws  ─────────────┐
  ▼                               ▼
Cloudflare Worker (fetch)   ClientSession DO  (one per browser tab/session)
  • serves static assets     • holds this client's selected stops
  • HttpApi REST routes        • alarm() polls every ~15–20s
  • routes WS upgrade ───────► • pushes departures over WebSocket (hibernatable)
                                   │ RPC
                                   ▼
                            GolemioGateway DO  (singleton "global")
                              • holds X-Access-Token (secret)
                              • v4 RateLimiter: ~20 req / 8s (memory store)
                              • ~5s coalescing cache
                              • ONLY caller of Golemio API
                                   │ HTTPS (X-Access-Token)
                                   ▼
                            Golemio /v2/public/departureboards
```

## 4. Components & boundaries

Each unit has one purpose, a defined interface, and is testable in isolation.

### 4.1 `@app/contract` (shared package)
The single source of truth for the API. Defines, with Effect v4's `HttpApi`
(`effect/unstable/httpapi`) + `Schema` (`effect/unstable/schema`):
- REST endpoints (e.g. health/version; room to grow).
- The **WebSocket message protocol** as a tagged union (`Schema.TaggedClass` /
  `Schema.Union`): client→server `Subscribe { stopIds }`, `Unsubscribe`;
  server→client `DeparturesUpdate { stops, departures, generatedAt }`,
  `Degraded { reason }`, `Error`.
- Shared domain types: a normalized `Departure` (route short name, vehicle type
  → tram/bus/metro, headsign, direction, scheduled + predicted timestamps,
  delay), and `StopRef`.

Both the Worker router and the browser client are derived from this package, so
the contract cannot drift.

### 4.2 Worker entry (`fetch`)
Three cleanly separated responsibilities, no business logic:
1. Serve static assets (the built `web` app + the stop index) via the assets
   binding.
2. Serve REST by turning the `HttpApiBuilder` router into a fetch handler via
   `effect/unstable/http` `toWebHandler` / `toWebHandlerLayer`
   (`HttpRouter.toWebHandler`).
3. Route `GET /api/ws` WebSocket upgrades to the correct `ClientSession` DO
   (`env.CLIENT_SESSION.idFromName(sessionId)`), forwarding the upgrade request.

### 4.3 `ClientSession` Durable Object
Owns one client's live subscription.
- Accepts a **hibernatable** WebSocket via `state.acceptWebSocket(ws)`.
- Stores the selected-stop set in DO storage (survives hibernation).
- Runs an `alarm()` poll loop (~15–20s); the first poll fires immediately on
  subscribe.
- Each poll batches **all** of this client's stops into **one** gateway call,
  normalizes the result, and pushes a `DeparturesUpdate`.
- Reacts to `Subscribe`/`Unsubscribe` messages over the existing socket — no
  reconnect needed to change stops.
- Cancels its alarm and goes dormant when the socket closes (`webSocketClose`).

### 4.4 `GolemioGateway` Durable Object (singleton)
The single choke point and the only code path to Golemio.
- Addressed by a fixed name (`idFromName("global")`).
- Exposes an RPC method, e.g. `getDepartures(stopSelectors): Promise<Board>`.
- Wraps every upstream call in v4's store-backed `RateLimiter`
  (`effect/unstable/persistence`) using `layerStoreMemory` — an in-memory store,
  ideal for a singleton DO. Configured to ~**20 req / 8 s** to match Golemio.
  Over-budget calls back-pressure, and shed past a timeout rather than hammering
  Golemio.
- Holds the `GOLEMIO_API_TOKEN` secret and adds the `X-Access-Token` header.
- Maintains a short **coalescing cache** (~5s, matching upstream `s-maxage=5`)
  keyed by the sorted stop-selector batch, so identical concurrent requests
  share one upstream call.
- **This is the "bake-in" extensibility boundary.** If usage blows up: (a) swap
  the `RateLimiter` store layer from memory to a distributed store
  (Redis-style / a DO-backed store) for cross-instance limiting, and/or (b)
  evolve this object into a per-stop dedup poller (decompose batches, cache per
  stop, fetch only stale stops, merge) — without touching the client DOs.

### 4.5 Golemio client (Effect)
A service built on `effect/unstable/http` `HttpClient` (`FetchHttpClient` on
Workers), used only inside the gateway. Calls `/v2/public/departureboards`,
decodes responses with `Schema` (`effect/unstable/schema`) — scheduled vs
predicted times, `delay`, route `type` → tram/bus/metro, headsign/direction —
and maps HTTP failures to typed errors (see §8).

### 4.6 Frontend (React + Vite)
- Derived client via `HttpApiClient.make` for REST; a `useDepartures` hook
  managing the WS subscription lifecycle (connect, subscribe, reconnect w/
  backoff, re-subscribe). *(v4 also ships `effect/unstable/reactivity` /
  `AtomHttpApi` and an `atom` package for React state — evaluate during planning.)*
- **Local per-second countdown ticking** from predicted timestamps between
  server pushes — the UI stays live with no per-second traffic.
- Selected-stop state synced to `localStorage` + the URL (shareable, restored
  on load).
- Stop search UI (see §5).

## 5. Stop search (client-side)

Golemio offers only exact-name lookup, so `tablo` owns the whole search
experience.

### 5.1 Build pipeline (`scripts/build-stop-index.ts`, build-time only)
1. Download + unzip `PID_GTFS.zip` (`data.pid.cz`), read `stops.txt`
   (+ a small `stop_times`→`trips`→`routes` join for the optional `modes` field).
2. **Group platform rows into user-facing stops**, keyed by **ASW node**
   (cleanest "everything at this place" selector; fall back to GTFS
   `parent_station`, then name + proximity if ASW columns are unavailable —
   *to verify against a real feed during planning*).
3. Normalize names (NFD + strip combining marks) and emit a compact,
   content-hashed index artifact served as a static asset.

### 5.2 Index entry (carries tomorrow's data today)
| Field | Purpose | v1 use |
|---|---|---|
| `name` | display ("Anděl") | yes |
| `aswNode` | departureboards query selector | yes |
| `lat`/`lon` | centroid — geo "near me" + proximity ranking | shipped, unused |
| `zone` | PID zone | shipped, light use |
| `modes` | tram/bus/metro icons before subscribing | slot present, empty |
| `disambig` | distinguish same-named stops across towns | yes |

The artifact is described by a **versioned `Schema`** (`effect/unstable/schema`)
so the format can evolve with explicit validation/migration.

### 5.3 Search behavior (v1)
- Diacritics-insensitive (`andel` → `Anděl`): fold both index and query.
- Matching/ranking via a tiny matcher (`uFuzzy`-class or hand-rolled — instant at
  ~6–9k short strings): exact prefix > word-boundary prefix > substring > fuzzy.
- Recents/favorites (from `localStorage`) surfaced when the box is empty.

### 5.4 Selecting a stop → departures
Selecting "Anděl" stores its `aswNode`; the gateway queries `aswIds[]=<node>`,
returning all directions/modes at that stop. A user's N stops become N selectors
in one batched call (well under the 100-stop cap). Per-direction filtering is
later pure client-side work (each departure carries headsign + direction).

### 5.5 Extension seams (built now, features deferred)
- **`IndexSource`** — loads/decodes the artifact. v1: bundled static asset.
  Later: a daily Cron→R2 fresh index is a new impl; nothing downstream changes.
- **Matcher** — pure `(query, stops) → candidates`. Stable.
- **Ranker** — a **composable pipeline of scorers**. v1: `[textRelevance,
  recents]`. Geo-proximity is an appended `proximityScorer`, active only when a
  location exists; matcher/index never know.
- **`LocationProvider`** — no-op in v1; browser Geolocation later. Geo "near me"
  = implement this + register the scorer.
- **`StopSearch` interface** — the React hook consumes this. Client and
  (potential) server search are two impls of one contract, keeping a server-side
  search option reachable if the index ever outgrows the browser.

## 6. Data flows

- **Subscribe:** WS open → `Subscribe(stopIds)` → DO stores set + schedules
  immediate and recurring alarms → each alarm → one batched gateway call →
  `DeparturesUpdate` pushed. Changing stops = one WS message, no reconnect.
- **Rate limiting:** every gateway call passes the token bucket; over-budget →
  back-pressure, then shed with a `Degraded` signal to the client.
- **Countdowns:** server sends predicted timestamps; client ticks locally each
  second.
- **Cold start / no stops:** no WS / idle DO; nothing polled.

## 7. Effect v4 usage notes

### Module map (v4 `effect/unstable/*` — no `@effect/platform`)
- **HttpApi** (contract, builder, client): `effect/unstable/httpapi`
  (`HttpApi`, `HttpApiBuilder`, `HttpApiClient`, `HttpApiEndpoint`,
  `HttpApiGroup`, `OpenApi`, `HttpApiScalar` …).
- **HTTP client/server + web handler**: `effect/unstable/http`
  (`HttpClient`, `FetchHttpClient`, `HttpRouter`, `toWebHandler`,
  `toWebHandlerLayer`).
- **Schema**: `effect/unstable/schema` (NOT `effect/Schema`).
- **RateLimiter**: `effect/unstable/persistence` (`RateLimiter.layer` +
  `layerStoreMemory`; Redis store layers exist for later).
- Core (`Effect`, `Layer`, `Context`, …): top-level `effect/*`.

### Notes
- **Serving the API:** build the router with `HttpApiBuilder`, then derive the
  Worker's REST `fetch` handler via `effect/unstable/http` `toWebHandler` /
  `toWebHandlerLayer`. Derive the browser client with `HttpApiClient.make`.
  OpenAPI/Scalar docs available via the `OpenApi` / `HttpApiScalar` modules.
- **Durable Objects + Effect:** each DO handler (`fetch`, `alarm`,
  `webSocketMessage`, `webSocketClose`) runs an Effect program via a
  `ManagedRuntime` built from the DO's layer. Subscription state persists in DO
  storage so it survives hibernation; the alarm drives polling.
- **RateLimiter:** store-backed `Context.Service`; provide `layerStoreMemory` in
  v1. `TestClock` makes its behavior unit-testable.
- **Toolchain:** TypeScript 6 + `@effect/language-service` (patched) + bundler
  module resolution. TS6 quirk: one-off `tsc <file>` with a tsconfig present
  needs `--ignoreConfig`.
- *To verify during planning:* the exact `toWebHandler`/`toWebHandlerLayer`
  wiring on Workers, the v4 `RateLimiter` config that maps to ~20/8s, and
  `ManagedRuntime` lifecycle inside a DO.

## 8. Error handling & resilience

- Golemio 429/5xx → typed Effect errors; the gateway serves stale-cached data if
  available and emits `Degraded { reason }` to clients.
- Rate-limit saturation → shed cleanly with an "updates delayed" status, never a
  hard failure.
- WS drops → client auto-reconnects with backoff and re-subscribes; the DO
  rebuilds state from the resent stop set.
- Schema decode failures → logged, surfaced as a typed error; one bad stop never
  takes down the whole board.

## 9. Testing

- Effect services unit-tested with `TestClock` (rate-limiter behavior, schema
  decode, departure normalization).
- HttpApi contract tested via the derived client against the in-memory handler
  (`HttpApiTest`).
- DO behavior (alarms, WS lifecycle, hibernation) via
  `@cloudflare/vitest-pool-workers` (Miniflare), with Golemio responses mocked
  from real-shape fixtures.
- Stop-search: matcher/ranker pure-function tests incl. diacritics + ranking
  order; a smoke test that the build pipeline produces a schema-valid index.

## 10. Repo structure

```
tablo/
  alchemy.run.ts            # Alchemy V2 infra: Worker + assets + 2 DO namespaces + secret
  packages/
    contract/               # @app/contract — HttpApi + Schema + WS protocol (shared)
    worker/                 # fetch entry, ClientSession DO, GolemioGateway DO, golemio client
      src/
        index.ts            # fetch: assets + HttpApi handler + WS upgrade routing
        session-do.ts       # ClientSession Durable Object
        gateway-do.ts       # GolemioGateway Durable Object (RateLimiter + cache)
        golemio/            # effect/unstable/http HttpClient + response schemas
    web/                    # React SPA (Vite) — HttpApiClient.make + useDepartures + search UI
  scripts/
    build-stop-index.ts     # PID_GTFS.zip → compact, versioned stop index (static asset)
  docs/superpowers/specs/   # this design + future specs
```

Tooling: **Bun + workspaces, Vite, Effect v4 beta, TypeScript 6** (flexible; pin
during planning).

## 11. Alchemy V2 deployment

A single `alchemy.run.ts` declares: the Worker (with the `web` build as static
assets), two Durable Object namespaces (`ClientSession`, `GolemioGateway`), and
the `GOLEMIO_API_TOKEN` secret. One deploy artifact, one command.
*Exact Alchemy V2 resource syntax to be pinned from current docs during planning.*

## 12. Decisions to verify during planning (no design impact)

1. PID `stops.txt` ASW id columns (drives the grouping key; documented fallbacks
   exist).
2. v4 web-handler wiring on Workers (`effect/unstable/http`
   `toWebHandler`/`toWebHandlerLayer`) + `ManagedRuntime`-in-DO lifecycle.
3. v4 `RateLimiter` (`effect/unstable/persistence`) config that maps to ~20/8s,
   and `layerStoreMemory` semantics.
4. Exact Alchemy V2 resource API for Worker + DO bindings + assets + secret.
5. Whether to prefer `aswIds` vs `ids` selectors per stop after inspecting real
   departureboard responses.
6. Golemio API key provisioning (free signup at `api.golemio.cz/api-keys`).

## 13. Future / extensibility (explicitly out of v1, designed-for)

- Geo-proximity ranking + "stops near me" (data already in the index; add
  `LocationProvider` + `proximityScorer`).
- Mode icons in search (populate the `modes` slot via the build-time join).
- Daily index refresh (Cron Trigger → R2 + a new `IndexSource`).
- Cross-client upstream dedup: swap the `RateLimiter` store from memory to a
  distributed store, and/or evolve `GolemioGateway` into a per-stop poller.
- Per-direction / per-mode filtering on a stop's board (pure client-side).
