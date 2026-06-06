import { Schema } from "effect"
import { VehicleKind } from "./domain.ts"

export const StopIndexEntry = Schema.Struct({
  name: Schema.String,            // display: "Anděl"
  norm: Schema.String,            // fold(name), search field
  node: Schema.Number,            // ASW node
  stops: Schema.NullOr(Schema.Array(Schema.Number)), // null = whole node
  lat: Schema.Number,
  lon: Schema.Number,
  zone: Schema.NullOr(Schema.String),
  modes: Schema.Array(VehicleKind), // empty in v1, slot reserved
  disambig: Schema.NullOr(Schema.String),
})
export type StopIndexEntry = typeof StopIndexEntry.Type

export const StopIndexV1 = Schema.Struct({
  version: Schema.Literal(1),
  generatedAt: Schema.String,
  stops: Schema.Array(StopIndexEntry),
})
export type StopIndexV1 = typeof StopIndexV1.Type

/** Versioned union — future versions join here with explicit migration. */
export const StopIndex = Schema.Union([StopIndexV1])
export type StopIndex = typeof StopIndex.Type

export const StopsManifest = Schema.Struct({
  path: Schema.String,
  generatedAt: Schema.String,
  count: Schema.Number,
})
export type StopsManifest = typeof StopsManifest.Type
