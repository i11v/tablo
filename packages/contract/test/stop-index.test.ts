import { describe, expect, it } from "vitest"
import { fold, RoutesAsset, ShapeAsset, StopIndex } from "@app/contract"
import { Schema } from "effect"

describe("fold", () => {
  it("strips diacritics and lowercases", () => {
    expect(fold("Anděl")).toBe("andel")
    expect(fold("Náměstí Míru")).toBe("namesti miru")
  })
})

describe("StopIndex", () => {
  it("decodes a v2 artifact and rejects unknown versions", () => {
    const v2 = {
      version: 2,
      generatedAt: "2026-07-20T00:00:00.000Z",
      stops: [
        {
          name: "Anděl",
          norm: "andel",
          node: 1040,
          stops: null,
          lat: 50.07,
          lon: 14.4,
          zone: "P",
          modes: ["tram"],
          routes: ["L9", "L22"],
          disambig: null,
          platforms: [{ code: "A", stop: 1, lat: 50.071, lon: 14.401 }],
        },
      ],
    }
    const dec = Schema.decodeUnknownSync(StopIndex)
    expect(dec(v2).version).toBe(2)
    expect(dec(v2).stops[0].platforms).toEqual([{ code: "A", stop: 1, lat: 50.071, lon: 14.401 }])
    expect(dec(v2).stops[0].routes).toEqual(["L9", "L22"])
    expect(() => dec({ ...v2, version: 1 })).toThrow('"version": 2')
    const noCoords = {
      ...v2,
      stops: [{ ...v2.stops[0], platforms: [{ code: "A", stop: 1 }] }],
    }
    expect(() => dec(noCoords)).toThrow("lat")
  })
})

describe("route assets", () => {
  it("decodes routes and shape assets", () => {
    const routes = [
      {
        id: "L22",
        shortName: "22",
        color: "7A0603",
        textColor: "FFFFFF",
        type: 0,
        shapePath: "/data/shapes/L22-abc12345.json",
      },
    ]
    expect(Schema.decodeUnknownSync(RoutesAsset)(routes)).toEqual(routes)
    const shape = {
      routeId: "L22",
      color: "7A0603",
      coords: [
        [
          [14.5, 50.05],
          [14.51, 50.06],
        ],
      ],
    }
    expect(Schema.decodeUnknownSync(ShapeAsset)(shape)).toEqual(shape)
  })
})
