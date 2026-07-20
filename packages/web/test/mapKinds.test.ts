import { describe, expect, it } from "vitest"
import { loadMapKinds } from "../src/lib/storage.ts"

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
