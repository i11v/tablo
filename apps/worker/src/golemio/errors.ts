import { Schema } from "effect"

export class GolemioRateLimitedError extends Schema.TaggedError<GolemioRateLimitedError>()(
  "GolemioRateLimitedError",
  {},
) {}

export class GolemioUpstreamError extends Schema.TaggedError<GolemioUpstreamError>()(
  "GolemioUpstreamError",
  { status: Schema.Number, detail: Schema.String },
) {}

/** Upstream answered 404 — an unknown trip, or one with no live position. */
export class GolemioNotFoundError extends Schema.TaggedError<GolemioNotFoundError>()(
  "GolemioNotFoundError",
  {},
) {}

export type GolemioError = GolemioRateLimitedError | GolemioUpstreamError | GolemioNotFoundError
