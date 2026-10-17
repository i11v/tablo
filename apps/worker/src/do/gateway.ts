import * as Cloudflare from "alchemy/Cloudflare"
import { Config, Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { RateLimiter } from "effect/persistence"
import type { BBox, StopSelector } from "@app/contract"
import { GolemioClient } from "../golemio/client.ts"
import { DepartureGateway } from "../gateway/service.ts"
import { TransitGateway } from "../gateway/transit.ts"
import { UpstreamGuard } from "../gateway/upstream.ts"
import { withCallerSpan } from "../trace.ts"

export class GolemioGateway extends Cloudflare.DurableObject<GolemioGateway>()(
  "GolemioGateway",
  Effect.gen(function* () {
    // Outer init: runs at deploy-plan (registers the secret binding) and at
    // cold start. `orDie` discharges the `ConfigError` the DO init phase
    // forbids (the namespace requires a `never` error channel).
    const token = yield* Config.Redacted("GOLEMIO_API_TOKEN").pipe(Effect.orDie)
    // Both gateways share ONE client and ONE UpstreamGuard (built once per
    // layer build), so boards, trips and vehicles draw from the same rate
    // budget and honour the same 429 cooldown.
    const gatewayLayer = Layer.mergeAll(DepartureGateway.layer, TransitGateway.layer).pipe(
      Layer.provide([
        GolemioClient.layer(token).pipe(Layer.provide(FetchHttpClient.layer)),
        UpstreamGuard.layer.pipe(
          Layer.provide(RateLimiter.layer.pipe(Layer.provide(RateLimiter.layerStoreMemory))),
        ),
      ]),
    )
    // Returning the inner init Effect is Alchemy's two-phase DO pattern.
    // @effect-diagnostics-next-line returnEffectInGen:off
    return Effect.gen(function* () {
      // Inner init: per instance / per hibernation wake. The in-memory limiter +
      // cache reset on wake — acceptable: the singleton only hibernates when idle.
      const { departures, transit } = yield* Effect.all({
        departures: DepartureGateway,
        transit: TransitGateway,
      }).pipe(Effect.provide(gatewayLayer))
      // Typed RPC, called via getByName("singleton"). Every method here
      // never fails: typed failures don't survive the DO RPC boundary
      // intact, so results are plain data (BoardsResult / Outcome).
      // `traceparent` nests the call under the caller's span (see trace.ts).
      return {
        /** Called by ClientSession. */
        getBoards: (selectors: ReadonlyArray<StopSelector>, traceparent?: string) =>
          departures.getBoards(selectors).pipe(withCallerSpan(traceparent)),
        /** Called by the Worker's /api/trips and /api/vehicles handlers. */
        getTrip: (tripId: string, traceparent?: string) =>
          transit.getTrip(tripId).pipe(withCallerSpan(traceparent)),
        getTripVehicle: (tripId: string, traceparent?: string) =>
          transit.getTripVehicle(tripId).pipe(withCallerSpan(traceparent)),
        getVehicles: (bbox: BBox, traceparent?: string) =>
          transit.getVehicles(bbox).pipe(withCallerSpan(traceparent)),
      }
    })
  }),
) {}
