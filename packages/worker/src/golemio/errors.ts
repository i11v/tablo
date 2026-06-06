import { Schema } from "effect"

export class GolemioRateLimitedError extends Schema.TaggedErrorClass<GolemioRateLimitedError>()(
  "GolemioRateLimitedError",
  {},
) {}

export class GolemioUpstreamError extends Schema.TaggedErrorClass<GolemioUpstreamError>()(
  "GolemioUpstreamError",
  { status: Schema.Number, detail: Schema.String },
) {}

export type GolemioError = GolemioRateLimitedError | GolemioUpstreamError
