import { Effect, Option, Tracer } from "effect"
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

/** The span a `traceparent` names, if it parses. */
export const fromTraceparent = (traceparent: string | undefined): Tracer.ExternalSpan | undefined =>
  traceparent === undefined
    ? undefined
    : Option.getOrUndefined(HttpTraceContext.fromHeaders(Headers.fromInput({ traceparent })))

/** Run `effect` as a child of the caller's span, when one was sent. */
export const withCallerSpan =
  (traceparent: string | undefined) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => {
    const parent = fromTraceparent(traceparent)
    return parent === undefined ? effect : Effect.withParentSpan(effect, parent)
  }

// Shared work (one Golemio fetch serving several sessions, a cached board)
// belongs to the trace that did it. Spans that reuse it link there instead.

/** The current span's ids, cheap to keep after the span ends. */
export const currentSpanRef: Effect.Effect<Tracer.ExternalSpan | undefined> =
  Effect.currentSpan.pipe(
    Effect.map((span) =>
      Tracer.externalSpan({ traceId: span.traceId, spanId: span.spanId, sampled: span.sampled }),
    ),
    Effect.orElseSucceed(() => undefined),
  )

/** Link the current span to each of `spans` once, skipping itself. */
export const linkCurrentSpan = (
  spans: Iterable<Tracer.AnySpan | undefined>,
  attributes: Readonly<Record<string, unknown>>,
): Effect.Effect<void> =>
  Effect.currentSpan.pipe(
    Effect.map((current) => {
      const seen = new Set([current.spanId])
      const links: Array<Tracer.SpanLink> = []
      for (const span of spans) {
        if (span === undefined || seen.has(span.spanId)) continue
        seen.add(span.spanId)
        links.push({ span, attributes })
      }
      if (links.length > 0) current.addLinks(links)
    }),
    Effect.orElseSucceed(() => undefined),
  )
