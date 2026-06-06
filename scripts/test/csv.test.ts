import { describe, expect, it } from "vitest"
import { parseCsv } from "../lib/csv.ts"

const CRLF = "a,b" + String.fromCharCode(13, 10) + "1,2" + String.fromCharCode(10) + "3,4"

describe("parseCsv", () => {
  it("parses plain rows incl. CRLF line endings", () => {
    expect(parseCsv(CRLF)).toEqual([["a", "b"], ["1", "2"], ["3", "4"]])
  })
  it("handles quoted fields with commas, escaped quotes and embedded newlines", () => {
    const input = 'a,b' + String.fromCharCode(10)
      + '"x,y","he said ""hi"""' + String.fromCharCode(10)
      + '"multi' + String.fromCharCode(10) + 'line",z'
    expect(parseCsv(input)).toEqual([
      ["a", "b"],
      ["x,y", 'he said "hi"'],
      ["multi" + String.fromCharCode(10) + "line", "z"],
    ])
  })
  it("keeps empty fields", () => {
    expect(parseCsv("a,,c")).toEqual([["a", "", "c"]])
  })
})
