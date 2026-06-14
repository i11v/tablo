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
  const andelP: StopIndexEntry = {
    ...entry("Anděl", 1040),
    platforms: [{ code: "A", stop: 1, lat: 50, lon: 14 }, { code: "B", stop: 2, lat: 50, lon: 14 }],
  }

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

  it("expands a multi-platform stop into grouped + per-platform candidates", () => {
    const r = searchStops([andelP], "andel")
    expect(r[0].platform).toBeNull()              // grouped row first
    expect(r[0].stops).toBeNull()
    expect(r.slice(1).map((c) => c.platform)).toEqual(["A", "B"])
    expect(r[1].stops).toEqual([1])
    expect(r[2].stops).toEqual([2])
  })

  it("matches a single platform when its code is typed", () => {
    const r = searchStops([andelP], "andel a")
    expect(r).toHaveLength(1)
    expect(r[0].platform).toBe("A")
    expect(r[0].stops).toEqual([1])
  })

  it("does not expand a single-platform stop", () => {
    const haje: StopIndexEntry = { ...entry("Háje", 100), platforms: [{ code: "A", stop: 1, lat: 50, lon: 14 }] }
    const r = searchStops([haje], "haje")
    expect(r).toHaveLength(1)
    expect(r[0].platform).toBeNull()
  })

  it("grouped row forwards a multi-name node's stop scope (not null)", () => {
    const multi: StopIndexEntry = {
      ...entry("Dělnická", 81),
      stops: [5, 6],
      platforms: [{ code: "A", stop: 5, lat: 50, lon: 14 }, { code: "B", stop: 6, lat: 50, lon: 14 }],
    }
    const r = searchStops([multi], "delnicka")
    expect(r[0].platform).toBeNull()
    expect(r[0].stops).toEqual([5, 6]) // grouped scope = the name's platforms, NOT null
    expect(r[1].stops).toEqual([5])    // per-platform rows still scope to one id
    expect(r[2].stops).toEqual([6])
  })
})

describe("rank", () => {
  it("boosts recents", () => {
    const candidates = searchStops(index, "and")
    const boosted = rank(candidates, ["2000"]) // Andělka recently used
    expect(boosted[0].entry.node).toBe(2000)
  })

  it("orders same-tier matches closest-first when a location is known", () => {
    // Both "Anděl" and "Andělka" are exact-prefix matches for "and"; proximity
    // breaks the tie. Place the user right next to the far-away one.
    const far = { ...entry("Anděl", 1040), lat: 50.1, lon: 14.5 }
    const near = { ...entry("Andělka", 2000), lat: 50.0, lon: 14.0 }
    const candidates = searchStops([far, near], "and")
    const ranked = rank(candidates, [], { lat: 50.0, lon: 14.0 })
    expect(ranked[0].entry.node).toBe(2000) // the nearby stop wins
  })

  it("leaves order unchanged without a location", () => {
    const candidates = searchStops(index, "and")
    const byScore = rank(candidates, [])
    const byScoreNull = rank(candidates, [], null)
    expect(byScoreNull.map((c) => c.entry.node)).toEqual(byScore.map((c) => c.entry.node))
  })
})
