import { Clock, Effect, Layer, Ref, Schema } from "effect"
import * as Context from "effect/Context"
import { RateLimiter } from "effect/persistence"
import { GolemioRateLimitedError } from "../golemio/errors.ts"

/** The call was refused locally: 429 cooldown active, or the limiter queue took too long. */
export class GatewayShedError extends Schema.TaggedError<GatewayShedError>()(
  "GatewayShedError",
  {},
) {}

const SHED_TIMEOUT = "5 seconds"
// After an upstream 429, stop calling Golemio entirely for this long. The
// internal limiter bounds our *rate* but doesn't *reduce* it when upstream
// explicitly asks us to back off; clients ride out the pause on stale data.
const RATE_LIMIT_COOLDOWN_MS = 30_000
const LIMIT = {
  key: "golemio",
  limit: 20,
  window: "8 seconds",
  algorithm: "fixed-window",
  onExceeded: "delay",
} as const

/** Short, log-safe reason for a failed upstream call (the error's tag). */
export const reasonOf = (error: unknown): string =>
  typeof error === "object" && error !== null && "_tag" in error
    ? String(error._tag)
    : String(error)

/**
 * The single budget every Golemio call spends from — boards, trips and
 * vehicles alike — so no endpoint can starve the others or dodge a 429
 * cooldown that another one triggered.
 */
export class UpstreamGuard extends Context.Service<
  UpstreamGuard,
  {
    /** Run one upstream call under the shared rate limit, shed timeout and 429 cooldown. */
    readonly run: <A, E>(
      call: Effect.Effect<A, E>,
    ) => Effect.Effect<A, E | GatewayShedError | RateLimiter.RateLimiterError>
  }
>()("@app/UpstreamGuard") {
  static readonly layer = Layer.effect(
    UpstreamGuard,
    Effect.gen(function* () {
      const withLimiter = yield* RateLimiter.makeWithRateLimiter
      const cooldownUntil = yield* Ref.make(0)

      const run = <A, E>(call: Effect.Effect<A, E>) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          if (now < (yield* Ref.get(cooldownUntil))) {
            return yield* new GatewayShedError()
          }
          return yield* call.pipe(
            withLimiter(LIMIT),
            Effect.timeoutOrElse({
              duration: SHED_TIMEOUT,
              orElse: () => new GatewayShedError(),
            }),
            Effect.tapError((e) =>
              e instanceof GolemioRateLimitedError
                ? Ref.set(cooldownUntil, now + RATE_LIMIT_COOLDOWN_MS)
                : Effect.void,
            ),
          )
        })

      return { run }
    }),
  )
}
