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
  vehicles: [],
  vehiclesAt: null,
  boardsDegraded: false,
  vehiclesDegraded: false,
}

const initial: DeparturesState = {
  status: "connecting",
  boards: new Map(),
  reason: null,
  vehicles: [],
  vehiclesAt: null,
  boardsDegraded: false,
  vehiclesDegraded: false,
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

  it("applies a VehiclesUpdate without touching boards", () => {
    const vehicle = {
      id: "t1",
      routeId: "L22",
      route: "22",
      kind: "tram" as const,
      lat: 50,
      lon: 14.4,
      bearing: 10,
      delaySeconds: 0,
      headsign: null,
      atStop: false,
      timestamp: "2026-07-20T09:00:00.000Z",
    }
    const next = applyServerMessage(initial, {
      _tag: "VehiclesUpdate",
      vehicles: [vehicle],
      generatedAt: "2026-07-20T09:00:01.000Z",
      degraded: false,
      reason: null,
    })
    expect(next.vehicles).toEqual([vehicle])
    expect(next.vehiclesAt).toBe("2026-07-20T09:00:01.000Z")
    expect(next.boards).toBe(initial.boards)
    expect(next.status).toBe("live")
  })

  it("marks the feed degraded on a degraded VehiclesUpdate", () => {
    const next = applyServerMessage(initial, {
      _tag: "VehiclesUpdate",
      vehicles: [],
      generatedAt: "2026-07-20T09:00:01.000Z",
      degraded: true,
      reason: "GolemioRateLimitedError",
    })
    expect(next.status).toBe("degraded")
    expect(next.reason).toBe("GolemioRateLimitedError")
    expect(next.vehiclesAt).toBe("2026-07-20T09:00:01.000Z")
  })

  it("keeps status degraded and preserves the reason when the other stream recovers", () => {
    const degradedBoards = applyServerMessage(live, {
      _tag: "DeparturesUpdate",
      boards: [],
      generatedAt: "2026-07-20T09:00:00.000Z",
      degraded: true,
      reason: "GolemioRateLimitedError",
    })
    expect(degradedBoards.status).toBe("degraded")

    const next = applyServerMessage(degradedBoards, {
      _tag: "VehiclesUpdate",
      vehicles: [],
      generatedAt: "2026-07-20T09:00:01.000Z",
      degraded: false,
      reason: null,
    })
    expect(next.status).toBe("degraded")
    expect(next.reason).toBe("GolemioRateLimitedError")
  })

  it("returns to live with a null reason once both streams report healthy", () => {
    const degradedBoards = applyServerMessage(live, {
      _tag: "DeparturesUpdate",
      boards: [],
      generatedAt: "2026-07-20T09:00:00.000Z",
      degraded: true,
      reason: "GolemioRateLimitedError",
    })
    const healthyVehicles = applyServerMessage(degradedBoards, {
      _tag: "VehiclesUpdate",
      vehicles: [],
      generatedAt: "2026-07-20T09:00:01.000Z",
      degraded: false,
      reason: null,
    })
    expect(healthyVehicles.status).toBe("degraded")

    const next = applyServerMessage(healthyVehicles, {
      _tag: "DeparturesUpdate",
      boards: [],
      generatedAt: "2026-07-20T09:00:02.000Z",
      degraded: false,
      reason: null,
    })
    expect(next.status).toBe("live")
    expect(next.reason).toBeNull()
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
