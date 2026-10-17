import { Api, TripNotFound, UpstreamUnavailable } from "@app/contract"
import { Cause, Effect, Layer } from "effect"
import * as Etag from "effect/http/Etag"
import * as HttpPlatform from "effect/http/HttpPlatform"
import { HttpApiBuilder } from "effect/http-api"
import type { Outcome, TransitApi } from "./gateway/transit.ts"
import { reasonOf } from "./gateway/upstream.ts"
import { currentTraceparent } from "./trace.ts"

/**
 * Unwrap a gateway Outcome into the endpoint's success / typed errors. The
 * stub's error channel says `never`, but the DO hop itself can still fail at
 * runtime (RpcCallError, an instance reset mid-call) — that's upstream being
 * unavailable from the client's point of view, never a 500.
 */
const resolve = <A, E>(
  outcome: Effect.Effect<Outcome<A>>,
  onNotFound: () => E,
): Effect.Effect<A, E | UpstreamUnavailable> =>
  Effect.gen(function* () {
    const o = yield* outcome.pipe(
      Effect.catchCause((cause) =>
        Effect.succeed<Outcome<A>>({
          _tag: "unavailable",
          reason: reasonOf(Cause.squash(cause)),
        }),
      ),
    )
    switch (o._tag) {
      case "ok":
        return o.value
      case "notFound":
        return yield* Effect.fail(onNotFound())
      case "unavailable":
        return yield* new UpstreamUnavailable({ reason: o.reason })
    }
  })

/**
 * The gateway as the Worker reaches it, over DO RPC: each call also takes the
 * caller's traceparent, which the RPC hop doesn't carry (see trace.ts).
 */
export type TransitRpc = {
  readonly [K in keyof TransitApi]: (
    ...args: [...Parameters<TransitApi[K]>, traceparent?: string]
  ) => ReturnType<TransitApi[K]>
}

/**
 * The HTTP API. `transit` resolves the gateway per request — in the Worker,
 * `() => namespace.getByName("singleton")`.
 */
export const apiLayer = (version: string, transit: () => TransitRpc) =>
  HttpApiBuilder.layer(Api).pipe(
    Layer.provide(
      HttpApiBuilder.group(Api, "system", (handlers) =>
        handlers.handle("health", () => Effect.succeed({ ok: true, version })),
      ),
    ),
    Layer.provide(
      HttpApiBuilder.group(Api, "transit", (handlers) =>
        handlers
          .handle("trip", ({ params }) =>
            resolve(
              Effect.flatMap(currentTraceparent, (tp) => transit().getTrip(params.tripId, tp)),
              () => new TripNotFound({ tripId: params.tripId }),
            ),
          )
          .handle("tripVehicle", ({ params }) =>
            resolve(
              Effect.flatMap(currentTraceparent, (tp) =>
                transit().getTripVehicle(params.tripId, tp),
              ),
              () => new TripNotFound({ tripId: params.tripId }),
            ),
          )
          .handle("vehicles", ({ query }) =>
            resolve(
              Effect.flatMap(currentTraceparent, (tp) => transit().getVehicles(query.bbox, tp)),
              // the gateway maps an empty box to an empty list; never expected
              () => new UpstreamUnavailable({ reason: "NotFound" }),
            ),
          ),
      ),
    ),
    Layer.provide([HttpPlatform.layer, Etag.layer]),
  )
