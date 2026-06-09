import { describe, expect, it } from "vitest"
import { workerName } from "../src/workerName.ts"

describe("workerName", () => {
  it("uses the bare name for production", () => {
    expect(workerName("production")).toBe("tablo")
  })

  it("suffixes preview stages so they can't collide with production", () => {
    expect(workerName("pr-42")).toBe("tablo-pr-42")
  })

  it("suffixes the local default dev stage", () => {
    expect(workerName("dev_ilnur")).toBe("tablo-dev_ilnur")
  })
})
