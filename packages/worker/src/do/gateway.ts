import * as Cloudflare from "alchemy/Cloudflare"
import { Config, Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { RateLimiter } from "effect/unstable/persistence"
import type { StopSelector } from "@app/contract"
import { GolemioClient } from "../golemio/client.ts"
import { DepartureGateway } from "../gateway/service.ts"
import { VehicleGateway } from "../gateway/vehicles.ts"

export class GolemioGateway extends Cloudflare.DurableObject<GolemioGateway>()(
  "GolemioGateway",
  Effect.gen(function* () {
    // Outer init: runs at deploy-plan (registers the secret binding) and at
    // cold start. `orDie` discharges the `ConfigError` the DO init phase
    // forbids (the namespace requires a `never` error channel).
    const token = yield* Config.redacted("GOLEMIO_API_TOKEN").pipe(Effect.orDie)
    // Both gateways share one GolemioClient + RateLimiter instance, so their
    // rate limits and 429 cooldowns are tracked against the same budget.
    const sharedLayer = GolemioClient.layer(token).pipe(
      Layer.provide(FetchHttpClient.layer),
      Layer.merge(RateLimiter.layer.pipe(Layer.provide(RateLimiter.layerStoreMemory))),
    )
    // A single Layer.merge + Layer.provide so sharedLayer is built once and
    // both gateways draw from the same GolemioClient/RateLimiter instance.
    const gatewayLayer = Layer.merge(DepartureGateway.layer, VehicleGateway.layer).pipe(
      Layer.provide(sharedLayer),
    )
    return Effect.gen(function* () {
      // Inner init: per instance / per hibernation wake. The in-memory limiter +
      // cache reset on wake — acceptable: the singleton only hibernates when idle.
      const { departures, vehicles } = yield* Effect.gen(function* () {
        const departures = yield* DepartureGateway
        const vehicles = yield* VehicleGateway
        return { departures, vehicles }
      }).pipe(Effect.provide(gatewayLayer))
      return {
        /** Typed RPC, called by ClientSession via getByName("singleton"). */
        getBoards: (selectors: ReadonlyArray<StopSelector>) => departures.getBoards(selectors),
        getVehicles: () => vehicles.getVehicles(),
      }
    })
  }),
) {}
