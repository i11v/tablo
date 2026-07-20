import { Schema } from "effect"
import { VehicleKind } from "./domain.ts"

export const StopPlatform = Schema.Struct({
  code: Schema.String, // platform_code: "A".."H", "1", "2"
  stop: Schema.Number, // asw_stop_id — selector scope when picked alone
  lat: Schema.Number, // this platform's own position (map marker)
  lon: Schema.Number,
})
export type StopPlatform = typeof StopPlatform.Type

export const StopIndexEntry = Schema.Struct({
  name: Schema.String, // display: "Anděl"
  norm: Schema.String, // fold(name), search field
  node: Schema.Number, // ASW node
  stops: Schema.NullOr(Schema.Array(Schema.Number)), // null = whole node
  lat: Schema.Number,
  lon: Schema.Number,
  zone: Schema.NullOr(Schema.String),
  modes: Schema.Array(VehicleKind), // derived from the node's routes
  routes: Schema.Array(Schema.String), // GTFS route ids serving this node
  disambig: Schema.NullOr(Schema.String),
  platforms: Schema.Array(StopPlatform), // non-blank-code platforms of this stop
})
export type StopIndexEntry = typeof StopIndexEntry.Type

// The index and the client deploy atomically (hashed asset + bundle), so no
// cross-version reader exists — v2 simply replaces v1 in the union.
export const StopIndexV2 = Schema.Struct({
  version: Schema.Literal(2),
  generatedAt: Schema.String,
  stops: Schema.Array(StopIndexEntry),
})
export type StopIndexV2 = typeof StopIndexV2.Type

/** Versioned union — future versions join here with explicit migration. */
export const StopIndex = Schema.Union([StopIndexV2])
export type StopIndex = typeof StopIndex.Type

export const StopsManifest = Schema.Struct({
  path: Schema.String,
  generatedAt: Schema.String,
  count: Schema.Number,
})
export type StopsManifest = typeof StopsManifest.Type

/** Per-route metadata + pointer to its hashed shape asset. */
export const RouteInfo = Schema.Struct({
  id: Schema.String, // GTFS route id, "L22"
  shortName: Schema.String, // "22"
  color: Schema.String, // hex without '#', from GTFS route_color
  textColor: Schema.String,
  type: Schema.Number, // GTFS route_type
  shapePath: Schema.String, // "/data/shapes/L22-<hash>.json"
})
export type RouteInfo = typeof RouteInfo.Type
export const RoutesAsset = Schema.Array(RouteInfo)
export type RoutesAsset = typeof RoutesAsset.Type

/** Simplified geometry for one route: segments of [lon, lat] points. */
export const ShapeAsset = Schema.Struct({
  routeId: Schema.String,
  color: Schema.String,
  coords: Schema.Array(Schema.Array(Schema.Array(Schema.Number))),
})
export type ShapeAsset = typeof ShapeAsset.Type
