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
})
