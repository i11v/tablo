import { describe, expect, it } from "vitest"
import type { Departure } from "@app/contract"
import { countdown } from "../src/lib/countdown.ts"

const dep = (over: Partial<Departure>): Departure => ({
  route: "9", kind: "tram", headsign: "X",
  scheduled: "2026-06-06T12:10:00.000Z", predicted: null,
  delaySeconds: null, isCanceled: false, isAtStop: false, platform: null,
  ...over,
})

const NOW = Date.parse("2026-06-06T12:00:00.000Z")

describe("countdown", () => {
  it("uses predicted over scheduled", () => {
    const c = countdown(dep({ predicted: "2026-06-06T12:05:00.000Z" }), NOW)
    expect(c).toEqual({ label: "5 min", gone: false, imminent: false })
  })
  it("falls back to scheduled", () => {
    expect(countdown(dep({}), NOW).label).toBe("10 min")
  })
  it("shows seconds under a minute and flags imminent", () => {
    const c = countdown(dep({ predicted: "2026-06-06T12:00:40.000Z" }), NOW)
    expect(c.label).toBe("40 s")
    expect(c.imminent).toBe(true)
  })
  it("shows 'now' around departure and marks gone after grace", () => {
    expect(countdown(dep({ predicted: "2026-06-06T12:00:05.000Z" }), NOW).label).toBe("now")
    expect(countdown(dep({ predicted: "2026-06-06T11:59:00.000Z" }), NOW).gone).toBe(true)
  })
})
