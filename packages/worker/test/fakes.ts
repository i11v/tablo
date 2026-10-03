import { Effect, Layer } from "effect"
import type * as Context from "effect/Context"
import { RateLimiter } from "effect/persistence"
import { GolemioClient } from "../src/golemio/client.ts"
import { UpstreamGuard } from "../src/gateway/upstream.ts"

type ClientShape = Context.Service.Shape<typeof GolemioClient>

/** A GolemioClient whose unused endpoints die loudly if a test hits them. */
export const fakeClient = (impl: Partial<ClientShape>): Layer.Layer<GolemioClient> =>
  Layer.succeed(GolemioClient, {
    fetchBoards: () => Effect.die("unexpected fetchBoards"),
    fetchTrip: () => Effect.die("unexpected fetchTrip"),
    fetchTripPosition: () => Effect.die("unexpected fetchTripPosition"),
    fetchVehicles: () => Effect.die("unexpected fetchVehicles"),
    ...impl,
  })

/** The real shared upstream guard over an in-memory limiter. Build it ONCE per
 * test (one layer reference) when several gateways must share it. */
export const guardLayer = UpstreamGuard.layer.pipe(
  Layer.provide(RateLimiter.layer.pipe(Layer.provide(RateLimiter.layerStoreMemory))),
)
