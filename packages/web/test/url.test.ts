import { describe, expect, it } from "vitest"
import { decodeSelection, encodeSelection } from "../src/lib/url.ts"

describe("selection URL codec", () => {
  it("round-trips", () => {
    const sel = [
      { selector: { node: 1040, stops: null }, name: "Anděl" },
      { selector: { node: 81, stops: [1, 2] }, name: "Dělnická" },
    ]
    const s = encodeSelection(sel)
    expect(s).toBe("1040~And%C4%9Bl;81_1_2~D%C4%9Blnick%C3%A1")
    expect(decodeSelection(s)).toEqual(sel)
  })
  it("tolerates junk", () => {
    expect(decodeSelection("")).toEqual([])
    expect(decodeSelection("garbage;;%%%")).toEqual([])
    expect(decodeSelection("12x~Bad")).toEqual([])
  })
})
