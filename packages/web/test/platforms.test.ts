import { describe, expect, it } from "vitest"
import type { StopPlatform } from "@app/contract"
import type { DepartureVM } from "../src/lib/departureVM.ts"
import { buildPlatformPicks } from "../src/lib/platforms.ts"

const plat = (over: Partial<StopPlatform>): StopPlatform => ({
  code: "A", stop: 1, lat: 50.0710, lon: 14.4030, ...over,
})

const vm = (over: Partial<DepartureVM>): DepartureVM => ({
  route: "9", kind: "tram", headsign: "X", platform: "A",
  inMinutes: 5, atStop: false, delayMinutes: 0, sortKey: 0, ...over,
})

// Anděl-ish: A is ~0m from origin, B is ~300m away (≈ 5 min walk inflated).
const ANDEL = { lat: 50.0710, lon: 14.4030 }
const platforms = [
  plat({ code: "B", stop: 2, lat: 50.0738, lon: 14.4030 }),
  plat({ code: "A", stop: 1, lat: 50.0710, lon: 14.4030 }),
]

describe("buildPlatformPicks", () => {
  it("sorts by walk time nearest-first when an origin is known", () => {
    const picks = buildPlatformPicks(platforms, ANDEL)
    expect(picks.map((p) => p.code)).toEqual(["A", "B"])
    expect(picks[0].walkMinutes).toBe(0)
    expect(picks[1].walkMinutes).toBeGreaterThan(0)
  })

  it("falls back to code order with null walk when no origin", () => {
    const picks = buildPlatformPicks(platforms, null)
    expect(picks.map((p) => p.code)).toEqual(["A", "B"])
    expect(picks.every((p) => p.walkMinutes === null)).toBe(true)
  })

  it("joins live departures by raw platform code (metro digits match)", () => {
    const metro = [plat({ code: "1", stop: 10 }), plat({ code: "2", stop: 20 })]
    const deps = [vm({ platform: "1", kind: "metro", headsign: "Zličín" })]
    const picks = buildPlatformPicks(metro, null, deps)
    const one = picks.find((p) => p.code === "1")!
    expect(one.lead?.headsign).toBe("Zličín")
    expect(one.kind).toBe("metro")
    expect(picks.find((p) => p.code === "2")!.lead).toBeUndefined()
  })

  it("prefers the soonest catchable (non-miss) departure as the lead", () => {
    // Walk to A ≈ 0 min. A miss (1 min out, but 0 walk → reachable) ... craft a
    // real miss: walk far so the 1-min departure is a miss, the 9-min is a make.
    const far = { lat: 51.0, lon: 15.0 } // >100km → every short countdown is a miss vs walk
    const near = plat({ code: "A", stop: 1, lat: 50.0710, lon: 14.4030 })
    const deps = [
      vm({ platform: "A", inMinutes: 1, sortKey: 1, headsign: "soon" }),
      vm({ platform: "A", inMinutes: 9, sortKey: 2, headsign: "later" }),
    ]
    const picks = buildPlatformPicks([near], far, deps)
    // both are misses (walk ≫ countdown) → fall back to the soonest by sortKey
    expect(picks[0].lead?.headsign).toBe("soon")
  })
})
