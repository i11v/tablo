import { describe, expect, it } from "vitest"
import { lerp, lerpAngle } from "../src/lib/map/lerp.ts"

describe("lerp", () => {
  it("interpolates linearly", () => {
    expect(lerp(0, 10, 0.5)).toBe(5)
  })
})

describe("lerpAngle", () => {
  it("crosses north along the shortest arc", () => {
    expect(lerpAngle(350, 10, 0.5)).toBe(0)
  })

  it("is symmetric regardless of direction", () => {
    expect(lerpAngle(10, 350, 0.5)).toBe(0)
  })
})
