import { describe, expect, it } from "vitest"
import { planTick } from "../src/do/cadence.ts"

describe("planTick", () => {
  it("stops entirely without sockets or subscriptions", () => {
    expect(
      planTick({ now: 0, hasSelectors: true, hasRoutes: true, hasSockets: false, boardsDueAt: 0 })
        .alarmAt,
    ).toBeNull()
    expect(
      planTick({ now: 0, hasSelectors: false, hasRoutes: false, hasSockets: true, boardsDueAt: 0 })
        .alarmAt,
    ).toBeNull()
  })
  it("keeps the 15s departures cadence without a vehicles subscription", () => {
    const plan = planTick({
      now: 1000,
      hasSelectors: true,
      hasRoutes: false,
      hasSockets: true,
      boardsDueAt: 0,
    })
    expect(plan).toEqual({
      alarmAt: 16_000,
      fetchVehicles: false,
      fetchBoards: true,
      boardsDueAt: 16_000,
    })
  })
  it("ticks at 5s with vehicles, refreshing boards only when due", () => {
    const first = planTick({
      now: 1000,
      hasSelectors: true,
      hasRoutes: true,
      hasSockets: true,
      boardsDueAt: 0,
    })
    expect(first).toEqual({
      alarmAt: 6_000,
      fetchVehicles: true,
      fetchBoards: true,
      boardsDueAt: 16_000,
    })
    const second = planTick({
      now: 6_000,
      hasSelectors: true,
      hasRoutes: true,
      hasSockets: true,
      boardsDueAt: 16_000,
    })
    expect(second.fetchBoards).toBe(false)
    expect(second.fetchVehicles).toBe(true)
    const due = planTick({
      now: 16_000,
      hasSelectors: true,
      hasRoutes: true,
      hasSockets: true,
      boardsDueAt: 16_000,
    })
    expect(due.fetchBoards).toBe(true)
    expect(due.boardsDueAt).toBe(31_000)
  })
  it("vehicles-only session never fetches boards", () => {
    const plan = planTick({
      now: 0,
      hasSelectors: false,
      hasRoutes: true,
      hasSockets: true,
      boardsDueAt: 0,
    })
    expect(plan.fetchBoards).toBe(false)
    expect(plan.fetchVehicles).toBe(true)
    expect(plan.alarmAt).toBe(5_000)
  })
})
