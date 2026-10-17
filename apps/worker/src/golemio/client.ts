import type { StopSelector } from "@app/contract"
import { Effect, Layer, Option, Redacted, Schema } from "effect"
import * as Context from "effect/Context"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { GolemioNotFoundError, GolemioRateLimitedError, GolemioUpstreamError } from "./errors.ts"
import {
  PidBoardResponse,
  PidTripPosition,
  PidTripResponse,
  PidVehiclePosition,
  PidVehiclePositions,
} from "./schema.ts"

const API = "https://api.golemio.cz"
const MINUTES_AFTER = 90
const PER_STOP_LIMIT = 20
// Golemio's cap on one page; PID tracks ~2–3k vehicles at peak, so one page is all of them.
const ALL_VEHICLES_LIMIT = 10_000
const decodeVehicle = Schema.decodeUnknownOption(PidVehiclePosition)

type FetchError = GolemioRateLimitedError | GolemioUpstreamError | Schema.SchemaError

export class GolemioClient extends Context.Service<
  GolemioClient,
  {
    readonly fetchBoards: (
      selectors: ReadonlyArray<StopSelector>,
    ) => Effect.Effect<PidBoardResponse, FetchError>
    /** A trip's stops, stop times and shape. */
    readonly fetchTrip: (
      tripId: string,
    ) => Effect.Effect<PidTripResponse, FetchError | GolemioNotFoundError>
    /** The live position of one trip's vehicle; NotFound when it isn't tracked. */
    readonly fetchTripPosition: (
      tripId: string,
    ) => Effect.Effect<PidTripPosition, FetchError | GolemioNotFoundError>
    /** Every tracked vehicle in PID, each with its last report's time; malformed ones dropped. */
    readonly fetchAllVehicles: () => Effect.Effect<ReadonlyArray<PidVehiclePosition>, FetchError>
  }
>()("@app/GolemioClient") {
  static readonly layer = (token: Redacted.Redacted<string>) =>
    Layer.effect(
      GolemioClient,
      Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient

        /** GET + status mapping + schema decode, shared by every endpoint. */
        const getJson = <S extends Schema.Top>(
          path: string,
          params: Record<string, string | ReadonlyArray<string>>,
          schema: S & { readonly DecodingServices: never },
        ) =>
          Effect.gen(function* () {
            const request = HttpClientRequest.get(API + path).pipe(
              HttpClientRequest.setUrlParams(params),
              HttpClientRequest.setHeader("X-Access-Token", Redacted.value(token)),
            )
            const response = yield* http.execute(request).pipe(
              Effect.timeoutOrElse({
                duration: "10 seconds",
                orElse: () => new GolemioUpstreamError({ status: 0, detail: "timeout" }),
              }),
              Effect.catchTag(
                "HttpClientError",
                (e) => new GolemioUpstreamError({ status: 0, detail: String(e) }),
              ),
            )
            if (response.status === 429) {
              return yield* new GolemioRateLimitedError()
            }
            if (response.status === 404) {
              return yield* new GolemioNotFoundError()
            }
            if (response.status < 200 || response.status >= 300) {
              return yield* new GolemioUpstreamError({
                status: response.status,
                detail: yield* response.text.pipe(Effect.orElseSucceed(() => "")),
              })
            }
            return yield* HttpClientResponse.schemaBodyJson(schema)(response).pipe(
              Effect.catchTag(
                "HttpClientError",
                (e) => new GolemioUpstreamError({ status: response.status, detail: String(e) }),
              ),
            )
          })

        const fetchBoards = Effect.fn("GolemioClient.fetchBoards")((
          selectors: ReadonlyArray<StopSelector>,
        ) => {
          const aswIds = selectors.flatMap((s) =>
            s.stops === null ? [`${s.node}`] : s.stops.map((p) => `${s.node}_${p}`),
          )
          return getJson(
            "/v2/pid/departureboards",
            {
              "aswIds[]": aswIds,
              mode: "departures",
              order: "real",
              minutesAfter: `${MINUTES_AFTER}`,
              limit: `${Math.min(1000, PER_STOP_LIMIT * aswIds.length)}`,
            },
            PidBoardResponse,
          ).pipe(
            // a board for unknown stops is just empty, not "not found"
            Effect.catchTag("GolemioNotFoundError", () =>
              Effect.succeed<PidBoardResponse>({ stops: [], departures: [] }),
            ),
          )
        })

        const fetchTrip = Effect.fn("GolemioClient.fetchTrip")((tripId: string) =>
          getJson(
            `/v2/gtfs/trips/${encodeURIComponent(tripId)}`,
            { includeStops: "true", includeStopTimes: "true", includeShapes: "true" },
            PidTripResponse,
          ),
        )

        const fetchTripPosition = Effect.fn("GolemioClient.fetchTripPosition")((tripId: string) =>
          getJson(`/v2/vehiclepositions/${encodeURIComponent(tripId)}`, {}, PidTripPosition),
        )

        const fetchAllVehicles = Effect.fn("GolemioClient.fetchAllVehicles")(() =>
          getJson(
            "/v2/vehiclepositions",
            { limit: `${ALL_VEHICLES_LIMIT}` },
            PidVehiclePositions,
          ).pipe(
            Effect.map(({ features }) => features.flatMap((f) => Option.toArray(decodeVehicle(f)))),
            // like boards: nothing tracked is an empty collection, not "not found"
            Effect.catchTag("GolemioNotFoundError", () => Effect.succeed([])),
          ),
        )

        return { fetchBoards, fetchTrip, fetchTripPosition, fetchAllVehicles }
      }),
    )
}
