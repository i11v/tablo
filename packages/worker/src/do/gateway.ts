import * as Cloudflare from "alchemy/Cloudflare"
import { Config, Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { RateLimiter } from "effect/unstable/persistence"
import type { StopSelector } from "@app/contract"
import { GolemioClient } from "../golemio/client.ts"
import { DepartureGateway } from "../gateway/service.ts"

export class GolemioGateway extends Cloudflare.DurableObject<GolemioGateway>()(
  "GolemioGateway",
  Effect.gen(function* () {
    // Outer init: runs at deploy-plan (registers the secret binding) and at
    // cold start. `orDie` discharges the `ConfigError` the DO init phase
    // forbids (the namespace requires a `never` error channel).
    const token = yield* Config.redacted("GOLEMIO_API_TOKEN").pipe(Effect.orDie)
    const gatewayLayer = DepartureGateway.layer.pipe(
      Layer.provide([
        GolemioClient.layer(token).pipe(Layer.provide(FetchHttpClient.layer)),
        RateLimiter.layer.pipe(Layer.provide(RateLimiter.layerStoreMemory)),
      ]),
    )
    return Effect.gen(function* () {
      // Inner init: per instance / per hibernation wake. The in-memory limiter +
      // cache reset on wake — acceptable: the singleton only hibernates when idle.
      const gateway = yield* DepartureGateway.pipe(Effect.provide(gatewayLayer))
      return {
        /** Typed RPC, called by ClientSession via getByName("singleton"). */
        getBoards: (selectors: ReadonlyArray<StopSelector>) => gateway.getBoards(selectors),
      }
    })
  }),
) {}
