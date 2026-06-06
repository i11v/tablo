import type { StopSelector } from "@app/contract"
import { Effect, Layer, Redacted, Schema } from "effect"
import * as Context from "effect/Context"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { GolemioRateLimitedError, GolemioUpstreamError } from "./errors.ts"
import { PidBoardResponse } from "./schema.ts"

const BASE_URL = "https://api.golemio.cz/v2/pid/departureboards"
const MINUTES_AFTER = 90
const PER_STOP_LIMIT = 20

export class GolemioClient extends Context.Service<
  GolemioClient,
  {
    readonly fetchBoards: (
      selectors: ReadonlyArray<StopSelector>,
    ) => Effect.Effect<
      PidBoardResponse,
      GolemioRateLimitedError | GolemioUpstreamError | Schema.SchemaError
    >
  }
>()("@app/GolemioClient") {
  static readonly layer = (token: Redacted.Redacted<string>) =>
    Layer.effect(
      GolemioClient,
      Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient

        const fetchBoards = Effect.fn("GolemioClient.fetchBoards")(
          (selectors: ReadonlyArray<StopSelector>) =>
            Effect.gen(function* () {
              const aswIds = selectors.flatMap((s) =>
                s.stops === null ? [`${s.node}`] : s.stops.map((p) => `${s.node}_${p}`),
              )
              const request = HttpClientRequest.get(BASE_URL).pipe(
                HttpClientRequest.setUrlParams({
                  "aswIds[]": aswIds,
                  mode: "departures",
                  order: "real",
                  minutesAfter: `${MINUTES_AFTER}`,
                  limit: `${Math.min(1000, PER_STOP_LIMIT * aswIds.length)}`,
                }),
                HttpClientRequest.setHeader("X-Access-Token", Redacted.value(token)),
              )
              const response = yield* http.execute(request).pipe(
                Effect.timeoutOrElse({
                  duration: "10 seconds",
                  orElse: () => new GolemioUpstreamError({ status: 0, detail: "timeout" }),
                }),
                Effect.catchTag("HttpClientError", (e) =>
                  new GolemioUpstreamError({ status: 0, detail: String(e) }),
                ),
              )
              if (response.status === 429) {
                return yield* new GolemioRateLimitedError()
              }
              if (response.status < 200 || response.status >= 300) {
                return yield* new GolemioUpstreamError({
                  status: response.status,
                  detail: yield* response.text.pipe(Effect.orElseSucceed(() => "")),
                })
              }
              return yield* HttpClientResponse.schemaBodyJson(PidBoardResponse)(response).pipe(
                Effect.catchTag("HttpClientError", (e) =>
                  new GolemioUpstreamError({ status: response.status, detail: String(e) }),
                ),
              )
            }),
        )

        return { fetchBoards }
      }),
    )
}
