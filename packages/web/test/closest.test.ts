import { describe, expect, it } from "vitest"
import type { StopIndexEntry } from "@app/contract"
import { closestEntry } from "../src/lib/map/closest.ts"

const entry = (name: string, lat: number, lon: number): StopIndexEntry => ({
  name,
  norm: name.toLowerCase(),
  node: 1,
  stops: null,
  lat,
  lon,
  zone: null,
  modes: [],
  routes: [],
  disambig: null,
  platforms: [],
})

describe("closestEntry", () => {
  it("picks the nearer of two entries", () => {
    const near = entry("near", 50.0, 14.0)
    const far = entry("far", 50.1, 14.5)
    expect(closestEntry([far, near], 50.0, 14.0)).toBe(near)
  })

  it("returns null for an empty array", () => {
    expect(closestEntry([], 50, 14)).toBeNull()
  })
})
