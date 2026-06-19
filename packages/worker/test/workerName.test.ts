import { describe, expect, it } from "vitest"
import {
  resolveWorkerStage,
  workerDomain,
  workerName,
} from "../src/workerName.ts"

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

describe("workerDomain", () => {
  it("serves production on the apex tablo.run", () => {
    expect(workerDomain("production")).toBe("tablo.run")
  })

  it("gives each PR preview its own preview-<N>.tablo.run hostname", () => {
    expect(workerDomain("pr-42")).toBe("preview-42.tablo.run")
  })

  it("has no custom domain for local/ad-hoc stages (workers.dev only)", () => {
    expect(workerDomain("dev_ilnur")).toBeUndefined()
    expect(workerDomain("local")).toBeUndefined()
  })

  it("only matches the exact pr-<digits> shape", () => {
    // guards against a malformed stage grabbing a preview hostname
    expect(workerDomain("pr-")).toBeUndefined()
    expect(workerDomain("pr-1a")).toBeUndefined()
    expect(workerDomain("prod-pr-1")).toBeUndefined()
  })
})

describe("resolveWorkerStage", () => {
  it("prefers TABLO_STAGE when set", () => {
    expect(resolveWorkerStage({ TABLO_STAGE: "production", USER: "ilnur" })).toBe(
      "production",
    )
  })

  it("falls back to alchemy's local default dev_<user>", () => {
    expect(resolveWorkerStage({ USER: "ilnur" })).toBe("dev_ilnur")
  })

  it("never resolves to production implicitly", () => {
    expect(resolveWorkerStage({})).toBe("local")
  })
})
