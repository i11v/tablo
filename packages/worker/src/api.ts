import { Api, TripNotFound, UpstreamUnavailable } from "@app/contract"
import { Cause, Effect, Layer } from "effect"
import * as Etag from "effect/http/Etag"
import * as HttpPlatform from "effect/http/HttpPlatform"
import { HttpApiBuilder } from "effect/http-api"
import type { Outcome, TransitApi } from "./gateway/transit.ts"
import { reasonOf } from "./gateway/upstream.ts"

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
 * The HTTP API. `transit` resolves the gateway per request — in the Worker,
 * `() => namespace.getByName("singleton")`.
 */
export const apiLayer = (version: string, transit: () => TransitApi) =>
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
              transit().getTrip(params.tripId),
              () => new TripNotFound({ tripId: params.tripId }),
            ),
          )
          .handle("tripVehicle", ({ params }) =>
            resolve(
              transit().getTripVehicle(params.tripId),
              () => new TripNotFound({ tripId: params.tripId }),
            ),
          )
          .handle("vehicles", ({ query }) =>
            resolve(
              transit().getVehicles(query.bbox),
              // the gateway maps an empty box to an empty list; never expected
              () => new UpstreamUnavailable({ reason: "NotFound" }),
            ),
          ),
      ),
    ),
    Layer.provide([HttpPlatform.layer, Etag.layer]),
  )
