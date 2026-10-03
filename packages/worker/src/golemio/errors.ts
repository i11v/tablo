import { Schema } from "effect"

export class GolemioRateLimitedError extends Schema.TaggedErrorClass<GolemioRateLimitedError>()(
  "GolemioRateLimitedError",
  {},
) {}

export class GolemioUpstreamError extends Schema.TaggedErrorClass<GolemioUpstreamError>()(
  "GolemioUpstreamError",
  { status: Schema.Number, detail: Schema.String },
) {}

/** Upstream answered 404 — an unknown trip, or one with no live position. */
export class GolemioNotFoundError extends Schema.TaggedErrorClass<GolemioNotFoundError>()(
  "GolemioNotFoundError",
  {},
) {}

export type GolemioError = GolemioRateLimitedError | GolemioUpstreamError | GolemioNotFoundError
