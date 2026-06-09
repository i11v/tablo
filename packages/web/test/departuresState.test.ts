import { describe, expect, it } from "vitest"
import type { ServerMessage } from "@app/contract"
import { applyServerMessage, type DeparturesState } from "../src/hooks/useDepartures.ts"

const live: DeparturesState = {
  status: "live",
  boards: new Map([["1040", { key: "1040", departures: [] }]]),
  reason: null,
}

describe("applyServerMessage", () => {
  it("replaces boards wholesale on DeparturesUpdate", () => {
    const msg: ServerMessage = {
      _tag: "DeparturesUpdate",
      boards: [{ key: "55", departures: [] }],
      generatedAt: "2026-06-09T12:00:00.000Z",
      degraded: false,
      reason: null,
    }
    const next = applyServerMessage(live, msg)
    expect(next.status).toBe("live")
    expect([...next.boards.keys()]).toEqual(["55"])
  })

  it("marks the feed degraded with the upstream reason", () => {
    const msg: ServerMessage = {
      _tag: "DeparturesUpdate",
      boards: [],
      generatedAt: "2026-06-09T12:00:00.000Z",
      degraded: true,
      reason: "GolemioRateLimitedError",
    }
    const next = applyServerMessage(live, msg)
    expect(next.status).toBe("degraded")
    expect(next.reason).toBe("GolemioRateLimitedError")
  })

  it("surfaces ServerError as degraded instead of swallowing it", () => {
    const msg: ServerMessage = { _tag: "ServerError", message: "bad subscribe" }
    const next = applyServerMessage(live, msg)
    expect(next.status).toBe("degraded")
    expect(next.reason).toBe("bad subscribe")
    // boards are kept — an error about one message doesn't blank the screen
    expect([...next.boards.keys()]).toEqual(["1040"])
  })
})
