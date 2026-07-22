import { describe, expect, it } from "vitest"
import { decodeMapKinds, loadMapKinds } from "../src/lib/storage.ts"

// vitest runs these in a node environment (no localStorage) — loadMapKinds'
// guarded read degrades to the default set, same as the other storage.ts
// loaders under Safari's "Block all cookies" / quota-exceeded paths.
describe("loadMapKinds", () => {
  it("defaults to every kind except metro when storage is unavailable", () => {
    const kinds = loadMapKinds()
    expect(kinds.has("metro")).toBe(false)
    expect([...kinds].sort()).toEqual(["bus", "other", "train", "tram"])
  })
})

describe("decodeMapKinds", () => {
  it("defaults to every kind except metro on null input", () => {
    const kinds = decodeMapKinds(null)
    expect(kinds.has("metro")).toBe(false)
    expect([...kinds].sort()).toEqual(["bus", "other", "train", "tram"])
  })

  it("defaults to every kind except metro on invalid JSON", () => {
    const kinds = decodeMapKinds("not json")
    expect(kinds.has("metro")).toBe(false)
    expect([...kinds].sort()).toEqual(["bus", "other", "train", "tram"])
  })

  it("round-trips a serialized set", () => {
    const original = new Set<"tram" | "metro" | "train" | "bus" | "other">(["tram", "metro"])
    const kinds = decodeMapKinds(JSON.stringify([...original]))
    expect([...kinds].sort()).toEqual([...original].sort())
  })

  it("filters out unknown values", () => {
    const kinds = decodeMapKinds(JSON.stringify(["tram", "boat"]))
    expect([...kinds]).toEqual(["tram"])
  })
})
