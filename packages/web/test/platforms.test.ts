import { describe, expect, it } from "vitest"
import type { StopPlatform } from "@app/contract"
import type { DepartureVM } from "../src/lib/departureVM.ts"
import { buildPlatformPicks } from "../src/lib/platforms.ts"

const plat = (over: Partial<StopPlatform>): StopPlatform => ({
  code: "A",
  stop: 1,
  lat: 0,
  lon: 0,
  ...over,
})

const vm = (over: Partial<DepartureVM>): DepartureVM => ({
  route: "9",
  kind: "tram",
  headsign: "X",
  platform: "A",
  inMinutes: 5,
  atStop: false,
  delayMinutes: 0,
  sortKey: 0,
  ...over,
})

describe("buildPlatformPicks", () => {
  const platforms = [plat({ code: "A", stop: 1 }), plat({ code: "B", stop: 2 })]

  it("lists every index platform in order, even without a board", () => {
    const picks = buildPlatformPicks(platforms)
    expect(picks.map((p) => p.code)).toEqual(["A", "B"])
    expect(picks.every((p) => p.lead === undefined)).toBe(true)
  })

  it("attaches the soonest departure leaving from each platform", () => {
    // Out of order on the wire would be a bug — boardToDepartures sorts ascending
    // — but assert we take the first match regardless, by listing the late one first.
    const deps = [
      vm({ platform: "A", headsign: "later", sortKey: 9 }),
      vm({ platform: "A", headsign: "soon", inMinutes: 1, sortKey: 1 }),
      vm({ platform: "B", headsign: "to Smíchov", kind: "tram" }),
    ]
    const picks = buildPlatformPicks(platforms, deps)
    expect(picks.find((p) => p.code === "A")!.lead?.headsign).toBe("later")
    const b = picks.find((p) => p.code === "B")!
    expect(b.lead?.headsign).toBe("to Smíchov")
    expect(b.kind).toBe("tram")
  })

  it("joins live departures by raw platform code (metro digits match)", () => {
    const metro = [plat({ code: "1", stop: 10 }), plat({ code: "2", stop: 20 })]
    const deps = [vm({ platform: "1", kind: "metro", headsign: "Zličín" })]
    const picks = buildPlatformPicks(metro, deps)
    const one = picks.find((p) => p.code === "1")!
    expect(one.lead?.headsign).toBe("Zličín")
    expect(one.kind).toBe("metro")
    expect(picks.find((p) => p.code === "2")!.lead).toBeUndefined()
  })
})
