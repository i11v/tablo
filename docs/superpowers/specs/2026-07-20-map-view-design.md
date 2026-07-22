# Map View with Live Vehicles — Design

**Date:** 2026-07-20
**Status:** Approved (prototype)
**Scope note:** This is a prototype of both UI and architecture. The visual
design is intentionally thin — enough to be usable and to exercise the data
paths. A proper visual pass will happen separately (Claude Design) once there
is something interactive to play with. Keep the map presentation behind a
narrow data-in/props-out boundary so restyling doesn't touch the data layers.

## Summary

A new `/map` view shows the user's closest stop with enough margin around it
to see approaching vehicles live. Only the lines serving that stop are drawn,
in official PID colors. Tapping a platform marker opens that platform's live
departures in a bottom sheet over the map. Vehicle-type filter chips
(tram / bus / metro / train) toggle both vehicles and drawn lines; metro is
unchecked by default.

## Verified upstream facts (research, 2026-07-20)

- Golemio `GET /v2/vehiclepositions` (same base URL and `X-Access-Token` as
  departureboards) returns a GeoJSON FeatureCollection of all tracked PID
  vehicles: point coords, `bearing`, `speed`, `delay.actual` (seconds),
  `state_position` (`at_stop`/`on_track`), `is_canceled`, `tracking`, and
  `trip.gtfs` (`route_id`, `route_short_name`, `route_type`, `trip_id`,
  `trip_headsign`). Metro is tracked. Full city ≈ 600 vehicles ≈ 61 KB gzipped;
  default `limit` is 100, so pass `limit=5000`. Positions refresh upstream
  roughly every 5 s. Rate limit is the same 20 req / 8 s pool the gateway
  already budgets.
- `GET /v2/gtfs/routes/{id}` has official `route_color` / `route_text_color`
  (e.g. tram 22 `7A0603`, metro A `00A562`).
- `data.pid.cz/PID_GTFS.zip` (already downloaded by `build-stop-index`)
  contains `routes.txt`, `trips.txt`, `shapes.txt`, `stop_times.txt`, and
  per-platform coordinates in `stops.txt`.

## 1. Route & navigation

New file route `packages/web/src/routes/map.tsx`, lazy-loaded so MapLibre
(~230 KB gz) never enters the board/search bundles. A map icon in the chrome
navigates board ⇄ map; navigations pass `shareSearch()` so `?s=` links
survive, matching existing routes.

Stack: **MapLibre GL JS** with **OpenFreeMap** vector tiles (keyless, free).
Style: whichever stock style is closest to the app's dark look; tuning is
deferred to the design pass.

## 2. Map behavior

- **Focus resolution:** geolocation active → closest node from the stop index
  (existing haversine helper). Geolocation denied/unavailable → city
  overview: central Prague, no focused stop, no lines; stop markers visible,
  tapping one focuses it.
- **Camera:** on focus, fit bounds to the stop centroid with ~700 m margin.
  Free pan/zoom always. Focus auto-switches to the new closest stop as
  geolocation updates, but never during user interaction; a recenter button
  returns to the user/stop.
- **Focused stop renders:** platform markers at per-platform coordinates; the
  stop's route polylines in official colors; vehicles only on those routes,
  rotated by bearing, labeled with the line short name, positions
  interpolated between 5 s ticks. Vehicles with timestamps older than ~60 s
  fade; a "last updated" indicator appears when data is stale.
- **Filters:** chip row over the map: tram / bus / metro / train. Metro
  unchecked on first ever visit; state persists in localStorage. A toggled-off
  kind hides both its vehicles and its polylines.
- **Platform tap:** bottom sheet over the map with that platform's live
  departures — subscribes via the existing WS `Subscribe` with
  `{node, stops:[stop]}` and reuses StopCard row rendering. A "pin to board"
  action adds the platform to `selectionStore`. The map stays visible behind
  the sheet.

## 3. Build-time data (extends `scripts/build-stop-index.ts`)

- **Stop index v2** (versioned union already anticipates this):
  - `platforms[*]` gain `lat` / `lon` from per-platform rows in `stops.txt`;
  - each node gains `routes: string[]` (GTFS route ids) via the
    `stop_times → trips → routes` join;
  - the reserved `modes` slot is filled from those routes' types (search mode
    icons come along for free).
- **New hashed `/data/` assets:**
  - one `routes-<hash>.json`: routeId → `{ shortName, color, textColor, type }`;
  - one GeoJSON per route, `shape/<routeId>-<hash>.json`: direction variants
    merged, Douglas-Peucker simplified to a few KB.
  - Manifest extended so the client can resolve hashed names. Only the focused
    stop's routes are fetched; service worker caches like the stop index.

## 4. Runtime data (live positions)

- **Contract (`@app/contract`):** `VehiclePosition` schema
  `{ id, routeId, route, kind, lat, lon, bearing, delaySeconds, headsign,
  atStop, timestamp }`. Protocol gains `SubscribeVehicles { routes }`,
  `UnsubscribeVehicles`, `VehiclesUpdate { vehicles }`.
- **Gateway DO:** `getVehicles()` fetches `/v2/vehiclepositions?limit=5000`
  city-wide, cached ~5 s with the same in-flight dedup and stale-fallback
  pattern as boards; slims features to the contract shape at the edge
  (drops ~90 % of bytes). One upstream call per tick serves all clients.
- **Session DO:** while a vehicles subscription is active the alarm runs at
  5 s; departures still refresh on every third tick (their current 15 s
  cadence). The session filters the city set to the subscribed routes before
  pushing (~1–5 KB frames).

## 5. Edge cases

- Untracked (`tracking: false`) and canceled vehicles are excluded at the
  gateway.
- A route with a missing shape asset still shows vehicles, just no polyline.
- Metro tunnels draw as normal polylines (metro is off by default anyway).
- Upstream failure degrades to stale positions + staleness indicator; never an
  error screen.
- No geolocation and nothing tapped → overview state with a "find your stop"
  hint.

## 6. Testing

Vitest, per-package, as today:

- **contract:** codec round-trips for the new protocol messages and
  `VehiclePosition`.
- **worker:** gateway vehicle slimming/filtering and cache behavior,
  mirroring `gateway.test.ts`.
- **web:** closest-node picker, filter-store persistence, vehicle
  interpolation math.
- **scripts:** platform-coordinate extraction and the routes join, in
  `build.test.ts` style.
- MapLibre rendering stays untested (browser-only) behind the thin
  presentation boundary.

## Decisions log

- Platform tap → bottom sheet on the map (not navigation to the board), with
  a pin-to-board action.
- Vehicles shown: only the focused stop's lines (not all vehicles in view).
- No-location fallback: city overview (not first selected stop, not a search
  prompt).
- Filters persist in localStorage; metro off by default on first visit.
- Focus auto-switches with movement, suppressed during interaction, with a
  recenter button.
- Stack: MapLibre + OpenFreeMap; WS/DO push with one shared city-wide fetch
  per 5 s tick; build-time geometry/colors from the GTFS zip.
