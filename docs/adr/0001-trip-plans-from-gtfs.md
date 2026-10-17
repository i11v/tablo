# 1. Serve trip plans from GTFS, not Golemio

Date: 2026-10-18 · Status: accepted

## Context

`GET /api/trips/:tripId` returns a trip's static plan: stops, scheduled times,
and route shape. It used to call Golemio through the singleton gateway Durable
Object, sharing one Golemio token's budget of 20 calls per 8 s with boards and
vehicles. The iOS app asks for a plan for every vehicle on the map, so a cold
launch cost ~20 upstream calls (~8 s). That cost grows with the number of
users, and every request also went through one Durable Object. With a public
release planned, neither holds up.

Golemio's trip endpoint is a view of PID's static GTFS feed (`data.pid.cz`,
daily, no token), which we already download at deploy time for the stop index.
Checked on 2026-10-17 against production:
- all 366 live vehicles' trip ids were in that day's feed;
- a plan built from GTFS with `toTrip`'s normalization matched
  `/api/trips/:id` byte for byte on every trip compared (19 of 19).

## Decision

Build every trip's plan from GTFS at deploy time and ship it with the Worker as
static assets: one JSON file per route prefix of the trip id
(`/data/trips/v1/991.json`, ~900 files, ~160 MB, largest ~2.3 MB, median ~30 KB;
format in `packages/contract/src/trip-bucket.ts`). The Worker reads them through
its `ASSETS` binding and keeps a few parsed files and many plans in isolate
memory. There is no Golemio fallback: the trip-plan path to Golemio
(`fetchTrip`, the gateway's trip cache, `toTrip`) is removed, so trips have one
source of truth. A daily scheduled deploy rebuilds the files from the new
feed.

## Options considered

- **Static assets (chosen).** Nothing new to provision: no binding, no
  credentials, no cost. Served from Cloudflare's edge. Upload is deduplicated by
  hash, so only routes that changed are re-uploaded. Data and code version
  together. The cost is that a data refresh means a redeploy, hence the daily
  schedule. The files are publicly fetchable, which is fine for public
  timetable data.
- **R2.** The natural home for data that changes apart from code. It would need
  a bucket resource, a separate upload job with R2 credentials in CI, and its
  own versioning, for no gain at this size.
- **D1.** Querying by id is cleaner, but a daily full reload is ~120k row
  writes, over the free plan's 100k/day, and avoiding that needs diff-based
  ingest. Reads also go to one primary region.
- **KV.** A daily reload of ~91k keys, with eventual consistency and write
  limits. Bucketing would recreate the asset design with more moving parts.
- **Ingest in a Worker cron.** The feed unzips to ~280 MB, and building takes
  ~2.3 GB of memory. That doesn't fit a Worker (128 MB), so the build stays in
  CI.
- **Persisting Golemio answers in the gateway DO** (i11v/tablo#52). It still
  pays one upstream call per trip per DO lifetime and keeps every request on
  one object. Closed unmerged.
- **GTFS with a Golemio fallback** for ids the deployed feed lacks. Every
  live trip id checked was in the feed, and the feed covers the next two
  weeks, so the fallback would rarely run. It would keep a second trip-plan
  implementation alive and keep trips on the shared upstream budget. Rejected.

## Consequences

- A plan costs no Golemio call and no Durable Object hop.
  `/api/trips/:tripId/vehicle` and `/api/vehicles` stay live and still go
  through the gateway.
- Plans are as fresh as the last deploy. An id the deployed feed lacks is a 404
  (`TripNotFound`). If a trip file can't be read or holds malformed data,
  that's a 503 (`UpstreamUnavailable`) so clients retry. If `data.pid.cz` is
  down at deploy time, the cached previous feed is used, as with the stop
  index. It covers ~2 weeks ahead.
- The HTTP contract is unchanged; the bucket format is internal and versioned
  by path (`v1`).
- Deploy artifacts grow by ~160 MB, and PR previews upload them too.
