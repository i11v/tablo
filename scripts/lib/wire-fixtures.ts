/**
 * Sample payloads for the iOS contract tests (ios/TabloTests/ContractTests.swift).
 *
 * Each value is typed by, and encoded with, the real contract schema, so the
 * JSON files are exactly what the backend sends (or accepts). Between them,
 * the samples of a surface must show every field in every form it can take
 * (a nullable field both null and set) — scripts/test/wire.test.ts checks.
 *
 * Regenerate after editing: `bun run contract:write`.
 */
import { Schema } from "effect"
import {
  ClientMessage,
  LiveVehicles,
  ServerMessage,
  StopIndex,
  StopsManifest,
  Trip,
  TripNotFound,
  TripVehicle,
  UpstreamUnavailable,
} from "@app/contract"

export const FIXTURES_DIR = "ios/TabloTests/ContractFixtures"

export interface Fixture {
  /** File name in FIXTURES_DIR, without `.json`. */
  readonly name: string
  /** The wire-shape surfaces (see wire-shape.ts) this payload belongs to. */
  readonly surfaces: readonly string[]
  /** The payload as JSON, encoded by its schema. */
  readonly json: unknown
}

const fixture = <
  S extends Schema.Top & { readonly DecodingServices: never; readonly EncodingServices: never },
>(
  name: string,
  surfaces: readonly string[],
  schema: S,
  value: S["Type"],
): Fixture => ({ name, surfaces, json: Schema.encodeSync(schema)(value) })

export const fixtures: readonly Fixture[] = [
  fixture("stops-manifest", ["GET /data/stops-manifest.json"], StopsManifest, {
    path: "/data/stop-index-b9cfa9fa.json",
    generatedAt: "2026-10-03T03:00:00.000Z",
    count: 2,
  }),

  fixture("stop-index", ["GET /data/stop-index-{hash}.json"], StopIndex, {
    version: 1,
    generatedAt: "2026-10-03T03:00:00.000Z",
    stops: [
      {
        name: "Národní třída",
        norm: "narodni trida",
        node: 539,
        stops: null,
        lat: 50.08069,
        lon: 14.41992,
        zone: "P",
        modes: ["tram"],
        disambig: null,
        platforms: [
          { code: "A", stop: 1, lat: 50.0813, lon: 14.4189 },
          { code: "B", stop: 2, lat: 50.0811, lon: 14.4196 },
        ],
      },
      {
        name: "Bečváry",
        norm: "becvary",
        node: 2154,
        stops: [301],
        lat: 49.95565,
        lon: 15.07087,
        zone: null,
        modes: [],
        disambig: "5",
        platforms: [],
      },
    ],
  }),

  fixture("ws-subscribe", ["WS /api/ws client"], ClientMessage, {
    _tag: "Subscribe",
    selectors: [
      { node: 539, stops: null },
      { node: 1040, stops: [1, 2] },
    ],
  }),

  fixture("ws-unsubscribe", ["WS /api/ws client"], ClientMessage, { _tag: "Unsubscribe" }),

  fixture("ws-departures-update", ["WS /api/ws server"], ServerMessage, {
    _tag: "DeparturesUpdate",
    generatedAt: "2026-10-03T09:10:45.141Z",
    degraded: true,
    reason: "upstream slow",
    boards: [
      {
        key: "539",
        departures: [
          {
            route: "22",
            kind: "tram",
            headsign: "Bílá Hora",
            scheduled: "2026-10-03T11:11:00+02:00",
            predicted: "2026-10-03T11:12:20+02:00",
            delaySeconds: 80,
            isCanceled: false,
            isAtStop: true,
            platform: "A",
            tripId: "22_1234_261003",
          },
          {
            route: "B",
            kind: "metro",
            headsign: "Zličín",
            scheduled: "2026-10-03T11:13:00+02:00",
            predicted: null,
            delaySeconds: null,
            isCanceled: true,
            isAtStop: false,
            platform: null,
            tripId: null,
          },
        ],
      },
      { key: "1040:1,2", departures: [] },
    ],
  }),

  fixture("ws-departures-update-healthy", ["WS /api/ws server"], ServerMessage, {
    _tag: "DeparturesUpdate",
    generatedAt: "2026-10-03T09:10:45.141Z",
    degraded: false,
    reason: null,
    boards: [],
  }),

  fixture("ws-server-error", ["WS /api/ws server"], ServerMessage, {
    _tag: "ServerError",
    message: "too many selectors",
  }),

  fixture("trip", ["GET /api/trips/{tripId} 200"], Trip, {
    tripId: "22_1234_261003",
    headsign: "Bílá Hora",
    stops: [
      {
        name: "Národní třída",
        lat: 50.0813,
        lon: 14.4189,
        node: 539,
        stop: 1,
        platform: "A",
        sequence: 12,
        arrival: 87000,
        departure: 87020,
        distance: 5.123,
      },
      {
        name: "Rail waypoint",
        lat: 50.1,
        lon: 14.5,
        node: null,
        stop: null,
        platform: null,
        sequence: 13,
        arrival: 87100,
        departure: 87100,
        distance: 5.9,
      },
    ],
    shape: [
      [14.4189, 50.0813, 5.1],
      [14.4176, 50.0811, 5.2],
    ],
  }),

  fixture("trip-vehicle", ["GET /api/trips/{tripId}/vehicle 200"], TripVehicle, {
    tripId: "22_1234_261003",
    lat: 50.08,
    lon: 14.42,
    bearing: 250,
    delaySeconds: 45,
    lastStopSequence: 11,
    nextStopSequence: 12,
    distance: 4.9,
    state: "on_track",
    updatedAt: "2026-10-03T09:10:45.000Z",
  }),

  fixture("trip-vehicle-untracked", ["GET /api/trips/{tripId}/vehicle 200"], TripVehicle, {
    tripId: "22_1234_261003",
    lat: 50.08,
    lon: 14.42,
    bearing: null,
    delaySeconds: null,
    lastStopSequence: null,
    nextStopSequence: null,
    distance: null,
    state: "before_track",
    updatedAt: "2026-10-03T09:10:45.000Z",
  }),

  fixture("live-vehicles", ["GET /api/vehicles 200"], LiveVehicles, {
    generatedAt: "2026-10-03T09:10:45.000Z",
    vehicles: [
      {
        tripId: "9_1",
        route: "9",
        kind: "tram",
        lat: 50.08,
        lon: 14.42,
        bearing: 90,
        delaySeconds: 30,
      },
      {
        tripId: "136_1",
        route: "136",
        kind: "bus",
        lat: 50.1,
        lon: 14.4,
        bearing: null,
        delaySeconds: null,
      },
    ],
  }),

  fixture(
    "error-trip-not-found",
    ["GET /api/trips/{tripId} 404", "GET /api/trips/{tripId}/vehicle 404"],
    TripNotFound,
    new TripNotFound({ tripId: "22_1234_261003" }),
  ),

  fixture(
    "error-upstream-unavailable",
    ["GET /api/trips/{tripId} 503", "GET /api/trips/{tripId}/vehicle 503", "GET /api/vehicles 503"],
    UpstreamUnavailable,
    new UpstreamUnavailable({ reason: "rate limited" }),
  ),
]

/** A fixture's file contents. */
export const fixtureText = (f: Fixture): string => JSON.stringify(f.json, null, 2) + "\n"
