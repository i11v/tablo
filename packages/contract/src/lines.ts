import { Schema } from "effect"
import { VehicleKind } from "./domain.ts"

/**
 * One stretch of the city network: track a set of modes run over. Routes
 * sharing a street or the other track of it are merged at build time, so
 * every stretch is drawn once whatever runs there.
 */
export const NetworkLine = Schema.Struct({
  /** The modes running here ("tram", "bus", "metro"); a stretch shows while any of them does. */
  kinds: Schema.Array(VehicleKind),
  /** lat, lon, lat, lon, … in travel order, 5 decimals (~1 m). */
  coords: Schema.Array(Schema.Number),
})
export type NetworkLine = typeof NetworkLine.Type

/**
 * Every city line's track (trams, buses, trolleybuses, metro; not regional
 * buses or trains), built from PID's GTFS shapes each deploy: the quiet
 * context the map draws behind the board.
 */
export const LinesV1 = Schema.Struct({
  version: Schema.Literal(1),
  generatedAt: Schema.String,
  lines: Schema.Array(NetworkLine),
})
export type LinesV1 = typeof LinesV1.Type

/** Versioned union — future versions join here with explicit migration. */
export const Lines = Schema.Union([LinesV1])
export type Lines = typeof Lines.Type

/** GET /data/lines-manifest.json — points at the current content-hashed lines file. */
export const LinesManifest = Schema.Struct({
  path: Schema.String,
  generatedAt: Schema.String,
  count: Schema.Number,
})
export type LinesManifest = typeof LinesManifest.Type
