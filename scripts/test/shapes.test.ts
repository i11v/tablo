import { describe, expect, it } from "vitest"
import { collectShapes, pickShapeIds } from "../lib/shapes.ts"

describe("shape selection", () => {
  it("picks the most-used shape per route+direction", () => {
    const trips = new Map([
      ["t1", { routeId: "L22", directionId: "0", shapeId: "A" }],
      ["t2", { routeId: "L22", directionId: "0", shapeId: "A" }],
      ["t3", { routeId: "L22", directionId: "0", shapeId: "B" }],
      ["t4", { routeId: "L22", directionId: "1", shapeId: "C" }],
    ])
    const picked = pickShapeIds(trips)
    expect(picked.get("A")).toBe("L22")
    expect(picked.get("C")).toBe("L22")
    expect(picked.has("B")).toBe(false)
  })

  it("collects ordered points for wanted shapes only", () => {
    const text = [
      "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence,shape_dist_traveled",
      "A,50.1,14.5,2,1.0",
      "A,50.0,14.4,1,0.0",
      "Z,10,10,1,0",
    ].join("\n")
    const wanted = new Map([["A", "L22"]])
    const shapes = collectShapes(text, wanted)
    expect(shapes.get("A")).toEqual([
      [14.4, 50.0],
      [14.5, 50.1],
    ])
    expect(shapes.has("Z")).toBe(false)
  })
})
