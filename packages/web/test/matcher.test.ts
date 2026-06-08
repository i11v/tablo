import { describe, expect, it } from "vitest"
import type { StopIndexEntry } from "@app/contract"
import { searchStops } from "../src/lib/matcher.ts"
import { rank } from "../src/lib/ranker.ts"

const entry = (name: string, node: number): StopIndexEntry => ({
  name, norm: name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase(),
  node, stops: null, lat: 50, lon: 14, zone: "P", modes: [], disambig: null, platforms: [],
})

const index = [
  entry("Anděl", 1040),
  entry("Andělka", 2000),
  entry("Náměstí Míru", 3000),
  entry("Staré Strašnice", 4000),
  entry("Malostranské náměstí", 5000),
]

describe("searchStops", () => {
  it("matches diacritics-insensitively", () => {
    const r = searchStops(index, "andel")
    expect(r[0].entry.name).toBe("Anděl")
  })
  it("ranks exact prefix above word-boundary prefix above substring", () => {
    const r = searchStops(index, "nam")
    expect(r[0].entry.name).toBe("Náměstí Míru")        // exact prefix
    expect(r[1].entry.name).toBe("Malostranské náměstí") // word-boundary prefix
  })
  it("returns nothing for no match and empty query", () => {
    expect(searchStops(index, "xyzxyz")).toEqual([])
    expect(searchStops(index, "  ")).toEqual([])
  })
})

describe("rank", () => {
  it("boosts recents", () => {
    const candidates = searchStops(index, "and")
    const boosted = rank(candidates, ["2000"]) // Andělka recently used
    expect(boosted[0].entry.node).toBe(2000)
  })
})
