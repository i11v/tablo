import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { routeTypeToKind, VehiclePosition } from "@app/contract"

const sample = {
  id: "22_40329_260718",
  routeId: "L22",
  route: "22",
  kind: "tram",
  lat: 50.053,
  lon: 14.536,
  bearing: 264,
  delaySeconds: 85,
  headsign: "Bílá Hora",
  atStop: true,
  timestamp: "2026-07-20T09:00:00.000Z",
}

describe("VehiclePosition", () => {
  it("decodes a full vehicle", () => {
    expect(Schema.decodeUnknownSync(VehiclePosition)(sample)).toEqual(sample)
  })

  it("accepts null bearing/delay/headsign", () => {
    const v = { ...sample, bearing: null, delaySeconds: null, headsign: null }
    expect(Schema.decodeUnknownSync(VehiclePosition)(v)).toEqual(v)
  })

  it("rejects unknown kinds", () => {
    expect(() => Schema.decodeUnknownSync(VehiclePosition)({ ...sample, kind: "boat" })).toThrow(
      'got "boat"',
    )
  })
})

describe("routeTypeToKind", () => {
  it("maps GTFS route types", () => {
    expect(routeTypeToKind(0)).toBe("tram")
    expect(routeTypeToKind(1)).toBe("metro")
    expect(routeTypeToKind(2)).toBe("train")
    expect(routeTypeToKind(3)).toBe("bus")
    expect(routeTypeToKind(11)).toBe("bus")
    expect(routeTypeToKind(7)).toBe("other")
    expect(routeTypeToKind(null)).toBe("other")
  })
})
