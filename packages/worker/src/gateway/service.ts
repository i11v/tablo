import type { StopBoard, StopSelector } from "@app/contract"
import { Cache, Clock, Effect, Layer, Ref, Schema } from "effect"
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

const CACHE_TTL = "5 seconds"
const SHED_TIMEOUT = "5 seconds"
// lastGood lives for the life of the singleton DO isolate and its keys are
// derived from client input — unbounded it is an OOM vector. Same capacity
// as the Cache; evicted keys just lose their stale fallback.
const LAST_GOOD_CAPACITY = 64
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

/** Canonical, order-independent cache key carrying the selectors themselves. */
const cacheKey = (selectors: ReadonlyArray<StopSelector>): string =>
  JSON.stringify(
    [...selectors]
      .map((s) => ({
        node: s.node,
        stops: s.stops === null ? null : [...s.stops].sort((a, b) => a - b),
      }))
      .sort((a, b) => a.node - b.node),
  )

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
      const lastGood = yield* Ref.make(new Map<string, BoardsResult>())
      const cooldownUntil = yield* Ref.make(0)

      const lookup = (key: string) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          if (now < (yield* Ref.get(cooldownUntil))) {
            return yield* new GatewayShedError()
          }
          const selectors = JSON.parse(key) as Array<StopSelector> // we produced the key
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
          const result: BoardsResult = {
            boards: toBoards(selectors, data),
            generatedAt: new Date().toISOString(),
            degraded: false,
            reason: null,
          }
          yield* Ref.update(lastGood, (m) => {
            const next = new Map(m)
            next.delete(key) // re-insert so iteration order tracks recency
            next.set(key, result)
            while (next.size > LAST_GOOD_CAPACITY) {
              next.delete(next.keys().next().value as string)
            }
            return next
          })
          return result
        })

      const cache = yield* Cache.make({ capacity: 64, timeToLive: CACHE_TTL, lookup })

      const getBoards = Effect.fn("DepartureGateway.getBoards")(
        (selectors: ReadonlyArray<StopSelector>) =>
          Effect.gen(function* () {
            const key = cacheKey(selectors)
            return yield* Cache.get(cache, key).pipe(
              Effect.catchIf(
                (_): _ is typeof _ => true,
                (error) =>
                  Effect.gen(function* () {
                    const stale = (yield* Ref.get(lastGood)).get(key)
                    const reason =
                      typeof error === "object" && error !== null && "_tag" in error
                        ? String(error._tag)
                        : String(error)
                    return stale !== undefined
                      ? { ...stale, degraded: true, reason }
                      : {
                          boards: [],
                          generatedAt: new Date().toISOString(),
                          degraded: true,
                          reason,
                        }
                  }),
              ),
            )
          }),
      )

      return { getBoards }
    }),
  )
}
