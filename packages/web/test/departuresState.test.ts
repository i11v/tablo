import { describe, expect, it } from "vitest"
import type { ServerMessage } from "@app/contract"
import {
  applyServerMessage,
  reconnectDelay,
  type DeparturesState,
} from "../src/hooks/useDepartures.ts"

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

describe("reconnectDelay", () => {
  it("backs off exponentially with 50-100% jitter", () => {
    expect(reconnectDelay(0, () => 0)).toBe(500)
    expect(reconnectDelay(0, () => 1)).toBe(1000)
    expect(reconnectDelay(2, () => 0)).toBe(2000)
    expect(reconnectDelay(2, () => 1)).toBe(4000)
  })

  it("caps at 30s regardless of attempt count", () => {
    expect(reconnectDelay(10, () => 1)).toBe(30_000)
    expect(reconnectDelay(1000, () => 1)).toBe(30_000)
    expect(reconnectDelay(1000, () => 0)).toBe(15_000)
  })
})
