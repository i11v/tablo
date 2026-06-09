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
    ).toThrow()
  })

  it("rejects non-integer and out-of-range ids", () => {
    const decode = Schema.decodeUnknownSync(ClientMessageJson)
    const subscribe = (selectors: unknown) =>
      JSON.stringify({ _tag: "Subscribe", selectors })
    expect(() => decode(subscribe([{ node: 1040.5, stops: null }]))).toThrow()
    expect(() => decode(subscribe([{ node: -1, stops: null }]))).toThrow()
    expect(() => decode(subscribe([{ node: 1e308, stops: null }]))).toThrow()
    expect(() => decode(subscribe([{ node: 1040, stops: [0] }]))).toThrow()
  })

  it("rejects oversized subscriptions (selector and platform caps)", () => {
    const decode = Schema.decodeUnknownSync(ClientMessageJson)
    const manySelectors = Array.from({ length: 21 }, (_, i) => ({
      node: i + 1,
      stops: null,
    }))
    expect(() =>
      decode(JSON.stringify({ _tag: "Subscribe", selectors: manySelectors })),
    ).toThrow()
    const manyPlatforms = [
      { node: 1040, stops: Array.from({ length: 17 }, (_, i) => i + 1) },
    ]
    expect(() =>
      decode(JSON.stringify({ _tag: "Subscribe", selectors: manyPlatforms })),
    ).toThrow()
    // At the caps it still decodes.
    const atCap = Array.from({ length: 20 }, (_, i) => ({
      node: i + 1,
      stops: [1, 2],
    }))
    expect(() =>
      decode(JSON.stringify({ _tag: "Subscribe", selectors: atCap })),
    ).not.toThrow()
  })
})
