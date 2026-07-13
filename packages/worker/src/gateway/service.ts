import type { StopBoard, StopSelector } from "@app/contract"
import { selectorKey } from "@app/contract"
import { Clock, Deferred, Effect, Layer, Ref, Schema } from "effect"
import * as Context from "effect/Context"
import { RateLimiter } from "effect/unstable/persistence"
import { GolemioClient } from "../golemio/client.ts"
import { toBoards } from "../golemio/normalize.ts"

export interface BoardsResult {
  readonly boards: ReadonlyArray<StopBoard>
  readonly generatedAt: string
  readonly degraded: boolean
  readonly reason: string | null
}

export class GatewayShedError extends Schema.TaggedErrorClass<GatewayShedError>()(
  "GatewayShedError",
  {},
) {}

const CACHE_TTL_MS = 5_000
const SHED_TIMEOUT = "5 seconds"
// One entry per selector key (a single stop's board). Entries newer than the
// TTL are served as fresh; older ones double as the stale fallback when
// upstream fails. Keys derive from client input, so unbounded the map is an
// OOM vector — evicted keys just lose their stale fallback.
const BOARD_CAPACITY = 64
// After an upstream 429, stop calling Golemio entirely for this long. The
// internal limiter bounds our *rate* but doesn't *reduce* it when upstream
// explicitly asks us to back off; clients ride out the pause on stale data.
const RATE_LIMIT_COOLDOWN_MS = 30_000
const LIMIT = {
  key: "golemio",
  limit: 20,
  window: "8 seconds",
  algorithm: "fixed-window",
  onExceeded: "delay",
} as const

interface CacheEntry {
  readonly board: StopBoard
  readonly fetchedAt: number
}

/** Outcome of one selector's fetch, delivered through its in-flight Deferred. */
type FetchOutcome =
  | { readonly ok: true; readonly board: StopBoard }
  | { readonly ok: false; readonly reason: string }

interface Claim {
  readonly key: string
  readonly selector: StopSelector
  readonly deferred: Deferred.Deferred<FetchOutcome>
}

const reasonOf = (error: unknown): string =>
  typeof error === "object" && error !== null && "_tag" in error
    ? String(error._tag)
    : String(error)

export class DepartureGateway extends Context.Service<
  DepartureGateway,
  {
    /** Never fails — degrades to stale or empty boards instead. */
    readonly getBoards: (selectors: ReadonlyArray<StopSelector>) => Effect.Effect<BoardsResult>
  }
>()("@app/DepartureGateway") {
  static readonly layer = Layer.effect(
    DepartureGateway,
    Effect.gen(function* () {
      const client = yield* GolemioClient
      const withLimiter = yield* RateLimiter.makeWithRateLimiter
      const cache = yield* Ref.make(new Map<string, CacheEntry>())
      const inflight = yield* Ref.make(new Map<string, Deferred.Deferred<FetchOutcome>>())
      const cooldownUntil = yield* Ref.make(0)

      const store = (boards: ReadonlyArray<StopBoard>, fetchedAt: number) =>
        Ref.update(cache, (m) => {
          const next = new Map(m)
          for (const board of boards) {
            next.delete(board.key) // re-insert so iteration order tracks recency
            next.set(board.key, { board, fetchedAt })
          }
          while (next.size > BOARD_CAPACITY) {
            next.delete(next.keys().next().value as string)
          }
          return next
        })

      /** One upstream call covering every claimed selector. Always completes
       * and releases every claim — including on interruption — so waiters on
       * other fibers can never hang. */
      const fetchClaimed = (claims: ReadonlyArray<Claim>) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          if (now < (yield* Ref.get(cooldownUntil))) {
            return yield* new GatewayShedError()
          }
          const selectors = claims.map((c) => c.selector)
          const data = yield* client.fetchBoards(selectors).pipe(
            withLimiter(LIMIT),
            Effect.timeoutOrElse({
              duration: SHED_TIMEOUT,
              orElse: () => new GatewayShedError(),
            }),
            Effect.tapError((e) =>
              e._tag === "GolemioRateLimitedError"
                ? Ref.set(cooldownUntil, now + RATE_LIMIT_COOLDOWN_MS)
                : Effect.void,
            ),
          )
          const boards = toBoards(selectors, data)
          yield* store(boards, yield* Clock.currentTimeMillis)
          const byKey = new Map(boards.map((b) => [b.key, b] as const))
          for (const c of claims) {
            yield* Deferred.succeed(c.deferred, {
              ok: true,
              board: byKey.get(c.key) ?? { key: c.key, departures: [] },
            })
          }
        }).pipe(
          Effect.catch((error) =>
            Effect.forEach(
              claims,
              (c) => Deferred.succeed(c.deferred, { ok: false, reason: reasonOf(error) }),
              { discard: true },
            ),
          ),
          // Runs on interrupt too; completing an already-done Deferred is a no-op.
          Effect.onExit(() =>
            Effect.gen(function* () {
              for (const c of claims) {
                yield* Deferred.succeed(c.deferred, { ok: false, reason: "Interrupted" })
              }
              yield* Ref.update(inflight, (m) => {
                const next = new Map(m)
                for (const c of claims) {
                  if (next.get(c.key) === c.deferred) next.delete(c.key)
                }
                return next
              })
            }),
          ),
        )

      const getBoards = Effect.fn("DepartureGateway.getBoards")(
        (selectors: ReadonlyArray<StopSelector>) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis

            // Dedupe by canonical key, preserving order for the response.
            const wanted: Array<{ key: string; selector: StopSelector }> = []
            const seenKeys = new Set<string>()
            for (const selector of selectors) {
              const key = selectorKey(selector)
              if (!seenKeys.has(key)) {
                seenKeys.add(key)
                wanted.push({ key, selector })
              }
            }

            // Per-key freshness: overlapping selector sets (search keystrokes,
            // the board and the search page, different sessions) share boards
            // instead of each set being its own all-or-nothing cache entry.
            const cached = yield* Ref.get(cache)
            const resolved = new Map<string, StopBoard>()
            const missing: Array<{ key: string; selector: StopSelector }> = []
            for (const w of wanted) {
              const entry = cached.get(w.key)
              if (entry !== undefined && now - entry.fetchedAt < CACHE_TTL_MS) {
                resolved.set(w.key, entry.board)
              } else {
                missing.push(w)
              }
            }

            // Claim the missing keys: ones another fiber is already fetching
            // are awaited; the rest are fetched here in a single batched call.
            // The Ref.modify is atomic, so a key is only ever fetched once.
            const candidates: Array<Claim> = []
            for (const m of missing) {
              candidates.push({ ...m, deferred: yield* Deferred.make<FetchOutcome>() })
            }
            const { claimed, waited } = yield* Ref.modify(inflight, (m) => {
              const next = new Map(m)
              const claimed: Array<Claim> = []
              const waited: Array<Claim> = []
              for (const c of candidates) {
                const existing = next.get(c.key)
                if (existing !== undefined) {
                  waited.push({ ...c, deferred: existing })
                } else {
                  next.set(c.key, c.deferred)
                  claimed.push(c)
                }
              }
              return [{ claimed, waited }, next] as const
            })

            if (claimed.length > 0) {
              yield* fetchClaimed(claimed)
            }

            let degraded = false
            let reason: string | null = null
            for (const c of [...claimed, ...waited]) {
              const outcome = yield* Deferred.await(c.deferred)
              if (outcome.ok) {
                resolved.set(c.key, outcome.board)
                continue
              }
              degraded = true
              reason ??= outcome.reason
              // Stale fallback per key; a key with no stale board is omitted
              // entirely, so the client keeps its loading state instead of
              // mistaking upstream trouble for "no departures".
              const stale = (yield* Ref.get(cache)).get(c.key)
              if (stale !== undefined) resolved.set(c.key, stale.board)
            }

            return {
              boards: wanted.flatMap((w) => {
                const board = resolved.get(w.key)
                return board === undefined ? [] : [board]
              }),
              generatedAt: new Date().toISOString(),
              degraded,
              reason,
            }
          }),
      )

      return { getBoards }
    }),
  )
}
