import { describe, expect, it } from "vitest"
import type { Departure } from "@app/contract"
import { boardToDepartures, departureVM } from "../src/lib/departureVM.ts"
import { reachTier } from "../src/lib/reach.ts"

const dep = (over: Partial<Departure>): Departure => ({
  route: "9", kind: "tram", headsign: "X",
  scheduled: "2026-06-06T12:10:00.000Z", predicted: null,
  delaySeconds: null, isCanceled: false, isAtStop: false, platform: null,
  ...over,
})

const NOW = Date.parse("2026-06-06T12:00:00.000Z")

describe("departureVM", () => {
  it("uses predicted over scheduled", () => {
    const vm = departureVM(dep({ predicted: "2026-06-06T12:05:00.000Z" }), NOW)
    expect(vm?.inMinutes).toBe(5)
  })

  it("falls back to scheduled", () => {
    expect(departureVM(dep({}), NOW)?.inMinutes).toBe(10)
  })

  it("floors minutes — 90s out is 1 min, not 2", () => {
    expect(departureVM(dep({ predicted: "2026-06-06T12:01:30.000Z" }), NOW)?.inMinutes).toBe(1)
    expect(departureVM(dep({ predicted: "2026-06-06T12:00:59.000Z" }), NOW)?.inMinutes).toBe(0)
  })

  it("drops canceled departures and ones gone past the grace window", () => {
    expect(departureVM(dep({ isCanceled: true }), NOW)).toBeNull()
    expect(departureVM(dep({ predicted: "2026-06-06T11:59:00.000Z" }), NOW)).toBeNull()
    // within the 30s grace it still shows, clamped to 0
    expect(departureVM(dep({ predicted: "2026-06-06T11:59:45.000Z" }), NOW)?.inMinutes).toBe(0)
  })

  it("converts delay seconds to signed minutes", () => {
    expect(departureVM(dep({ delaySeconds: 120 }), NOW)?.delayMinutes).toBe(2)
    expect(departureVM(dep({ delaySeconds: -60 }), NOW)?.delayMinutes).toBe(-1)
    expect(departureVM(dep({}), NOW)?.delayMinutes).toBe(0)
  })

  it("sorts a board ascending by effective time", () => {
    const board = {
      key: "1040",
      departures: [
        dep({ scheduled: "2026-06-06T12:08:00.000Z" }),
        dep({ scheduled: "2026-06-06T12:20:00.000Z", predicted: "2026-06-06T12:04:00.000Z" }),
      ],
    }
    expect(boardToDepartures(board, NOW).map((d) => d.inMinutes)).toEqual([4, 8])
  })
})

describe("reachTier", () => {
  it("is neutral without a location fix", () => {
    expect(reachTier(5, null)).toBe("neutral")
  })

  it("classifies miss / run / make by walking margin", () => {
    expect(reachTier(4, 5)).toBe("miss")
    expect(reachTier(5, 5)).toBe("run")
    expect(reachTier(6, 5)).toBe("run")
    expect(reachTier(7, 5)).toBe("make")
  })
})
