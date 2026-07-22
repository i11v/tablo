import { describe, expect, it } from "vitest"
import { simplify } from "../lib/simplify.ts"

describe("simplify (Douglas-Peucker)", () => {
  it("keeps endpoints and drops collinear interior points", () => {
    const line: Array<[number, number]> = [
      [0, 0],
      [1, 1.00001],
      [2, 2],
      [3, 3],
    ]
    expect(simplify(line, 0.001)).toEqual([
      [0, 0],
      [3, 3],
    ])
  })

  it("keeps genuine corners", () => {
    const corner: Array<[number, number]> = [
      [0, 0],
      [1, 0],
      [1, 1],
    ]
    expect(simplify(corner, 0.001)).toEqual(corner)
  })

  it("passes through short inputs", () => {
    expect(simplify([[0, 0]], 0.001)).toEqual([[0, 0]])
  })
})
