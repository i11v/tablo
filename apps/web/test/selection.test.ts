import { describe, expect, it } from "vitest"
import { MAX_SELECTORS, selectorKey } from "@app/contract"
import { addSelection, removeSelection } from "../src/lib/selection.ts"

const stop = (node: number) => ({ selector: { node, stops: null }, name: `S${node}` })

describe("selection transforms", () => {
  it("adds newest-on-top", () => {
    const a = stop(1)
    const b = stop(2)
    expect(addSelection([a], b.selector, b.name)).toEqual([b, a])
  })

  it("adds to an empty selection", () => {
    const a = stop(1)
    expect(addSelection([], a.selector, a.name)).toEqual([a])
  })

  it("caps at MAX_SELECTORS, returning the same array unchanged", () => {
    const full = Array.from({ length: MAX_SELECTORS }, (_, i) => stop(i))
    const result = addSelection(full, { node: 999, stops: null }, "overflow")
    expect(result).toBe(full) // same ref → caller skips its side effects (save, pushRecent)
    expect(result.length).toBe(MAX_SELECTORS)
  })

  it("removes the entry matching a selector key", () => {
    const a = stop(1)
    const b = stop(2)
    expect(removeSelection([a, b], selectorKey(b.selector))).toEqual([a])
  })

  it("is a no-op when the key is absent", () => {
    const a = stop(1)
    expect(removeSelection([a], "no-such-key")).toEqual([a])
  })
})
