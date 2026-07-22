import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { toVehicles, VehiclePositionsResponse } from "../src/golemio/vehicles.ts"

const feature = (over: Record<string, unknown> = {}) => ({
  geometry: { coordinates: [14.6161737, 50.0837135] },
  properties: {
    trip: {
      gtfs: {
        route_id: "L1001",
        route_short_name: "S1",
        route_type: 2,
        trip_id: "1001_9360_260603",
        trip_headsign: "Praha hl.n.",
      },
    },
    last_position: {
      bearing: 264,
      delay: { actual: 85 },
      is_canceled: false,
      origin_timestamp: "2026-07-20T09:00:00.000Z",
      state_position: "at_stop",
      tracking: true,
      ...over,
    },
  },
})

describe("vehicle positions normalization", () => {
  const decode = Schema.decodeUnknownSync(VehiclePositionsResponse)

  it("maps a tracked vehicle to the contract shape", () => {
    const [v] = toVehicles(decode({ features: [feature()] }))
    expect(v).toEqual({
      id: "1001_9360_260603",
      routeId: "L1001",
      route: "S1",
      kind: "train",
      lat: 50.0837135,
      lon: 14.6161737,
      bearing: 264,
      delaySeconds: 85,
      headsign: "Praha hl.n.",
      atStop: true,
      timestamp: "2026-07-20T09:00:00.000Z",
    })
  })

  it("drops canceled vehicles", () => {
    expect(toVehicles(decode({ features: [feature({ is_canceled: true })] }))).toEqual([])
  })

  it("drops untracked vehicles", () => {
    expect(toVehicles(decode({ features: [feature({ tracking: false })] }))).toEqual([])
  })

  it("tolerates null bearing/delay/tracking", () => {
    const [v] = toVehicles(
      decode({ features: [feature({ bearing: null, delay: { actual: null }, tracking: null })] }),
    )
    expect(v).toBeDefined()
    expect(v.bearing).toBeNull()
    expect(v.delaySeconds).toBeNull()
  })
})
