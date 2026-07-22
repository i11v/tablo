import type { VehiclePosition } from "@app/contract"
import { Clock, Deferred, Effect, Layer, Ref } from "effect"
import * as Context from "effect/Context"
import { RateLimiter } from "effect/unstable/persistence"
import { GolemioClient } from "../golemio/client.ts"
import { toVehicles } from "../golemio/vehicles.ts"

export interface VehiclesResult {
  readonly vehicles: ReadonlyArray<VehiclePosition>
  readonly generatedAt: string
  readonly degraded: boolean
  readonly reason: string | null
}

// Slightly under the 5s poll tick so a tick never sees a just-expired cache.
const CACHE_TTL_MS = 4_500
const RATE_LIMIT_COOLDOWN_MS = 30_000
const LIMIT = {
  key: "golemio",
  limit: 20,
  window: "8 seconds",
  algorithm: "fixed-window",
  onExceeded: "delay",
} as const

interface CacheEntry {
  readonly vehicles: ReadonlyArray<VehiclePosition>
  readonly fetchedAt: number
}

type Outcome =
  | { readonly ok: true; readonly vehicles: ReadonlyArray<VehiclePosition> }
  | { readonly ok: false; readonly reason: string }

const reasonOf = (error: unknown): string =>
  typeof error === "object" && error !== null && "_tag" in error
    ? String(error._tag)
    : String(error)

export class VehicleGateway extends Context.Service<
  VehicleGateway,
  {
    /** Never fails — degrades to stale or empty instead. */
    readonly getVehicles: () => Effect.Effect<VehiclesResult>
  }
>()("@app/VehicleGateway") {
  static readonly layer = Layer.effect(
    VehicleGateway,
    Effect.gen(function* () {
      const client = yield* GolemioClient
      const withLimiter = yield* RateLimiter.makeWithRateLimiter
      const cache = yield* Ref.make<CacheEntry | null>(null)
      const inflight = yield* Ref.make<Deferred.Deferred<Outcome> | null>(null)
      const cooldownUntil = yield* Ref.make(0)

      const fetchCity = (deferred: Deferred.Deferred<Outcome>) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          if (now < (yield* Ref.get(cooldownUntil))) {
            return yield* Deferred.succeed(deferred, { ok: false, reason: "GatewayShedError" })
          }
          const data = yield* client.fetchVehicles().pipe(
            withLimiter(LIMIT),
            Effect.tapError((e) =>
              e._tag === "GolemioRateLimitedError"
                ? Ref.set(cooldownUntil, now + RATE_LIMIT_COOLDOWN_MS)
                : Effect.void,
            ),
          )
          const vehicles = toVehicles(data)
          yield* Ref.set(cache, { vehicles, fetchedAt: yield* Clock.currentTimeMillis })
          yield* Deferred.succeed(deferred, { ok: true, vehicles })
        }).pipe(
          Effect.catch((error) =>
            Deferred.succeed(deferred, { ok: false, reason: reasonOf(error) }),
          ),
          Effect.onExit(() =>
            Effect.gen(function* () {
              yield* Deferred.succeed(deferred, { ok: false, reason: "Interrupted" })
              yield* Ref.update(inflight, (d) => (d === deferred ? null : d))
            }),
          ),
        )

      const getVehicles = Effect.fn("VehicleGateway.getVehicles")(() =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const cached = yield* Ref.get(cache)
          if (cached !== null && now - cached.fetchedAt < CACHE_TTL_MS) {
            return {
              vehicles: cached.vehicles,
              generatedAt: new Date().toISOString(),
              degraded: false,
              reason: null,
            }
          }
          const mine = yield* Deferred.make<Outcome>()
          const { claimed, deferred } = yield* Ref.modify(inflight, (d) =>
            d === null
              ? [{ claimed: true, deferred: mine }, mine]
              : [{ claimed: false, deferred: d }, d],
          )
          if (claimed) yield* fetchCity(deferred)
          const outcome = yield* Deferred.await(deferred)
          if (outcome.ok) {
            return {
              vehicles: outcome.vehicles,
              generatedAt: new Date().toISOString(),
              degraded: false,
              reason: null,
            }
          }
          const stale = yield* Ref.get(cache)
          return {
            vehicles: stale?.vehicles ?? [],
            generatedAt: new Date().toISOString(),
            degraded: true,
            reason: outcome.reason,
          }
        }),
      )

      return { getVehicles }
    }),
  )
}
