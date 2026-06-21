import { describe, expect, it } from "vitest"
import { fold, StopIndex } from "@app/contract"
import { Schema } from "effect"

describe("fold", () => {
  it("strips diacritics and lowercases", () => {
    expect(fold("Anděl")).toBe("andel")
    expect(fold("Náměstí Míru")).toBe("namesti miru")
  })
})

describe("StopIndex", () => {
  it("decodes a v1 artifact and rejects unknown versions", () => {
    const v1 = {
      version: 1,
      generatedAt: "2026-06-06T00:00:00.000Z",
      stops: [
        {
          name: "Anděl",
          norm: "andel",
          node: 1040,
          stops: null,
          lat: 50.07,
          lon: 14.4,
          zone: "P",
          modes: [],
          disambig: null,
          platforms: [{ code: "A", stop: 1 }],
        },
      ],
    }
    const dec = Schema.decodeUnknownSync(StopIndex)
    expect(dec(v1).version).toBe(1)
    expect(dec(v1).stops[0].platforms).toEqual([{ code: "A", stop: 1 }])
    expect(() => dec({ ...v1, version: 2 })).toThrow('"version": 1')
    const noPlatforms = { ...v1, stops: [{ ...v1.stops[0], platforms: undefined }] }
    expect(() => dec(noPlatforms)).toThrow("Expected array")
  })
})
