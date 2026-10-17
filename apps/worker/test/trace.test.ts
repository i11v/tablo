import { describe, expect, it } from "vitest"
import { Effect, Option } from "effect"
import { currentTraceparent, withCallerSpan } from "../src/trace.ts"

describe("trace context across a DO hop", () => {
  it("runs the callee's spans in the caller's trace", async () => {
    const callee = Effect.fn("callee")(function* () {
      return yield* Effect.currentSpan
    })
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const caller = yield* Effect.currentSpan
        const traceparent = yield* currentTraceparent
        const span = yield* callee().pipe(withCallerSpan(traceparent))
        return { caller, span }
      }).pipe(Effect.withSpan("caller")),
    )
    expect(result.span.traceId).toBe(result.caller.traceId)
    expect(Option.getOrUndefined(result.span.parent)?.spanId).toBe(result.caller.spanId)
  })

  it("has no traceparent outside a span, and leaves the callee alone", async () => {
    const traceparent = await Effect.runPromise(currentTraceparent)
    expect(traceparent).toBeUndefined()
    const value = await Effect.runPromise(Effect.succeed(1).pipe(withCallerSpan(undefined)))
    expect(value).toBe(1)
  })
})
