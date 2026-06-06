import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Redacted } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { GolemioClient } from "../src/golemio/client.ts"
import { fixture } from "./fixtures/departureboards.ts"

const capture: { url: URL | null } = { url: null }

const mockHttp = (status: number, body: unknown) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request, url) => {
      capture.url = url
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json" },
          }),
        ),
      )
    }),
  )

const layerWith = (status: number, body: unknown) =>
  GolemioClient.layer(Redacted.make("test-token")).pipe(Layer.provide(mockHttp(status, body)))

describe("GolemioClient", () => {
  it.effect("builds aswIds[] params and decodes the response", () =>
    Effect.gen(function* () {
      const client = yield* GolemioClient
      const data = yield* client.fetchBoards([
        { node: 1040, stops: null },
        { node: 81, stops: [1, 2] },
      ])
      expect(data.departures).toHaveLength(4)
      const params = capture.url!.searchParams
      expect(params.getAll("aswIds[]")).toEqual(["1040", "81_1", "81_2"])
      expect(params.get("mode")).toBe("departures")
      expect(params.get("order")).toBe("real")
      expect(Number(params.get("minutesAfter"))).toBeGreaterThan(0)
    }).pipe(Effect.provide(layerWith(200, fixture))),
  )

  it.effect("maps 429 to GolemioRateLimitedError", () =>
    Effect.gen(function* () {
      const client = yield* GolemioClient
      const exit = yield* Effect.exit(client.fetchBoards([{ node: 1, stops: null }]))
      expect(exit._tag).toBe("Failure")
      expect(JSON.stringify(exit)).toContain("GolemioRateLimitedError")
    }).pipe(Effect.provide(layerWith(429, {}))),
  )

  it.effect("maps 401 to GolemioUpstreamError with status", () =>
    Effect.gen(function* () {
      const client = yield* GolemioClient
      const exit = yield* Effect.exit(client.fetchBoards([{ node: 1, stops: null }]))
      expect(JSON.stringify(exit)).toContain("GolemioUpstreamError")
      expect(JSON.stringify(exit)).toContain("401")
    }).pipe(Effect.provide(layerWith(401, { error_message: "unauthorized", error_status: 401 }))),
  )
})
