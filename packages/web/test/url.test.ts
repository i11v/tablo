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
  it("round-trips names containing '~'", () => {
    const sel = [{ selector: { node: 7, stops: null }, name: "Foo~Bar" }]
    const s = encodeSelection(sel)
    expect(s).toBe("7~Foo~Bar")
    expect(decodeSelection(s)).toEqual(sel)
  })
  it("tolerates junk", () => {
    expect(decodeSelection("")).toEqual([])
    expect(decodeSelection("garbage;;%%%")).toEqual([])
    expect(decodeSelection("12x~Bad")).toEqual([])
  })
  it("dedupes repeated selectors (first name wins)", () => {
    expect(decodeSelection("1040~A;1040~B")).toEqual([
      { selector: { node: 1040, stops: null }, name: "A" },
    ])
    // same platforms in a different order are the same selector
    expect(decodeSelection("81_2_1~A;81_1_2~B").length).toBe(1)
    // but a different platform subset is a distinct board
    expect(decodeSelection("81_1~A;81_2~B").length).toBe(2)
  })
})
