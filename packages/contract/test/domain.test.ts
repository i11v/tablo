import { describe, expect, it } from "vitest"
import { selectorKey, StopSelector } from "@app/contract"
import { Schema } from "effect"

describe("StopSelector", () => {
  it("decodes node-only and platform-scoped selectors", () => {
    const dec = Schema.decodeUnknownSync(StopSelector)
    expect(dec({ node: 1040, stops: null })).toEqual({ node: 1040, stops: null })
    expect(dec({ node: 81, stops: [1, 2] })).toEqual({ node: 81, stops: [1, 2] })
    expect(() => dec({ node: "x", stops: null })).toThrow()
  })

  it("selectorKey is canonical", () => {
    expect(selectorKey({ node: 1040, stops: null })).toBe("1040")
    expect(selectorKey({ node: 81, stops: [2, 1] })).toBe("81:1,2")
  })
})
