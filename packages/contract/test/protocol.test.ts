import { describe, expect, it } from "vitest"
import { ClientMessageJson, ServerMessageJson } from "@app/contract"
import { Schema } from "effect"

describe("WS protocol", () => {
  it("round-trips a Subscribe message through JSON", () => {
    const msg = {
      _tag: "Subscribe" as const,
      selectors: [{ node: 1040, stops: null }],
    }
    const encoded = Schema.encodeUnknownSync(ClientMessageJson)(msg)
    expect(typeof encoded).toBe("string")
    expect(Schema.decodeUnknownSync(ClientMessageJson)(encoded)).toEqual(msg)
  })

  it("decodes a DeparturesUpdate and dispatches on _tag", () => {
    const wire = JSON.stringify({
      _tag: "DeparturesUpdate",
      boards: [{ key: "1040", departures: [] }],
      generatedAt: "2026-06-06T12:00:00.000Z",
      degraded: false,
      reason: null,
    })
    const msg = Schema.decodeUnknownSync(ServerMessageJson)(wire)
    expect(msg._tag).toBe("DeparturesUpdate")
  })

  it("rejects unknown tags", () => {
    expect(() =>
      Schema.decodeUnknownSync(ServerMessageJson)(JSON.stringify({ _tag: "Nope" })),
    ).toThrow("_tag")
  })

  it("rejects non-integer and out-of-range ids", () => {
    const decode = Schema.decodeUnknownSync(ClientMessageJson)
    const subscribe = (selectors: unknown) => JSON.stringify({ _tag: "Subscribe", selectors })
    expect(() => decode(subscribe([{ node: 1040.5, stops: null }]))).toThrow("an integer")
    expect(() => decode(subscribe([{ node: -1, stops: null }]))).toThrow("between 1 and 999999")
    expect(() => decode(subscribe([{ node: 1e308, stops: null }]))).toThrow("an integer")
    expect(() => decode(subscribe([{ node: 1040, stops: [0] }]))).toThrow("between 1 and 999999")
  })

  it("round-trips SubscribeVehicles / UnsubscribeVehicles", () => {
    const sub = { _tag: "SubscribeVehicles" as const, routes: ["L22", "L991"] }
    const encoded = Schema.encodeUnknownSync(ClientMessageJson)(sub)
    expect(Schema.decodeUnknownSync(ClientMessageJson)(encoded)).toEqual(sub)
    const unsub = { _tag: "UnsubscribeVehicles" as const }
    expect(
      Schema.decodeUnknownSync(ClientMessageJson)(
        Schema.encodeUnknownSync(ClientMessageJson)(unsub),
      ),
    ).toEqual(unsub)
  })

  it("rejects oversized or malformed vehicle route subscriptions", () => {
    const decode = Schema.decodeUnknownSync(ClientMessageJson)
    const routes33 = Array.from({ length: 33 }, (_, i) => "L" + i)
    expect(() => decode(JSON.stringify({ _tag: "SubscribeVehicles", routes: routes33 }))).toThrow(
      "length of at most 32",
    )
    expect(() =>
      decode(JSON.stringify({ _tag: "SubscribeVehicles", routes: ["x".repeat(17)] })),
    ).toThrow("length of at most 16")
    expect(() => decode(JSON.stringify({ _tag: "SubscribeVehicles", routes: [""] }))).toThrow(
      "length of at least 1",
    )
  })

  it("round-trips a VehiclesUpdate", () => {
    const msg = {
      _tag: "VehiclesUpdate" as const,
      vehicles: [],
      generatedAt: "2026-07-20T09:00:00.000Z",
      degraded: false,
      reason: null,
    }
    const encoded = Schema.encodeUnknownSync(ServerMessageJson)(msg)
    expect(Schema.decodeUnknownSync(ServerMessageJson)(encoded)).toEqual(msg)
  })

  it("rejects oversized subscriptions (selector and platform caps)", () => {
    const decode = Schema.decodeUnknownSync(ClientMessageJson)
    const manySelectors = Array.from({ length: 21 }, (_, i) => ({
      node: i + 1,
      stops: null,
    }))
    expect(() => decode(JSON.stringify({ _tag: "Subscribe", selectors: manySelectors }))).toThrow(
      "length of at most 20",
    )
    const manyPlatforms = [{ node: 1040, stops: Array.from({ length: 17 }, (_, i) => i + 1) }]
    expect(() => decode(JSON.stringify({ _tag: "Subscribe", selectors: manyPlatforms }))).toThrow(
      "length of at most 16",
    )
    // At the caps it still decodes.
    const atCap = Array.from({ length: 20 }, (_, i) => ({
      node: i + 1,
      stops: [1, 2],
    }))
    expect(() => decode(JSON.stringify({ _tag: "Subscribe", selectors: atCap }))).not.toThrow()
  })
})
