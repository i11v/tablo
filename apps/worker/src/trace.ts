import { Effect, Option } from "effect"
import * as Headers from "effect/http/Headers"
import * as HttpTraceContext from "effect/http/HttpTraceContext"

// Alchemy's Durable Object RPC carries no trace context, so a call into a DO
// would start a trace of its own. Callers send their span's W3C traceparent
// as an extra argument, and the DO side runs the call under it.

/** The current span's `traceparent`, if there is a span. */
export const currentTraceparent: Effect.Effect<string | undefined> = Effect.currentSpan.pipe(
  Effect.map((span) => HttpTraceContext.toHeaders(span).traceparent),
  Effect.orElseSucceed(() => undefined),
)

/** Run `effect` as a child of the caller's span, when one was sent. */
export const withCallerSpan =
  (traceparent: string | undefined) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => {
    if (traceparent === undefined) return effect
    const parent = HttpTraceContext.fromHeaders(Headers.fromInput({ traceparent }))
    return Option.isSome(parent) ? Effect.withParentSpan(effect, parent.value) : effect
  }
