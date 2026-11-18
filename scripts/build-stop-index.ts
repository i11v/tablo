import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { $ } from "bun"
import { Schema } from "effect"
import {
  LinesManifest,
  LinesV1,
  StopIndexV1,
  StopsManifest,
  TRIP_BUCKET_DIR,
  tripBucketPath,
} from "@app/contract"
import { buildTripBuckets } from "../apps/worker/src/gtfs/buckets.ts"
import { iterCsv, parseCsv } from "./lib/csv.ts"
import { buildIndex } from "./lib/build.ts"
import { buildLines } from "./lib/lines.ts"

const GTFS_URL = "https://data.pid.cz/PID_GTFS.zip"
const TMP = ".alchemy/tmp-gtfs"
const OUT_DIR = "apps/web/public/data"
// Last good copy of the feed. CI restores/saves this via actions/cache so a
// data.pid.cz outage can't block a deploy (stops change rarely; a slightly
// stale index is strictly better than no hotfix).
const CACHE_DIR = ".cache"
const CACHE_ZIP = CACHE_DIR + "/PID_GTFS.zip"

const res = await fetch(GTFS_URL).catch(() => null)
if (res !== null && res.ok) {
  await mkdir(CACHE_DIR, { recursive: true })
  await Bun.write(CACHE_ZIP, res)
} else if (existsSync(CACHE_ZIP)) {
  console.warn(
    "GTFS download failed (" +
      (res === null ? "network error" : "HTTP " + res.status) +
      ") — falling back to cached " +
      CACHE_ZIP,
  )
} else {
  throw new Error(
    "GTFS download failed (" +
      (res === null ? "network error" : "HTTP " + res.status) +
      ") and no cached copy exists",
  )
}
await rm(TMP, { recursive: true, force: true })
await mkdir(TMP, { recursive: true })
await $`unzip -o ${CACHE_ZIP} stops.txt routes.txt trips.txt stop_times.txt shapes.txt -d ${TMP}`.quiet()

const rows = parseCsv(await Bun.file(TMP + "/stops.txt").text())
const index = buildIndex(rows, new Date().toISOString())
Schema.decodeUnknownSync(StopIndexV1)(index) // fail loudly on schema drift

const json = JSON.stringify(index)
// Hash only the data payload. generatedAt changes on every build, and
// including it would give identical stops data a different filename each
// deploy — defeating the hash-immutable design (clients' 60-day CacheFirst
// entries and cross-deploy reuse only work when same data => same URL).
const hash = createHash("sha256")
  .update(JSON.stringify({ version: index.version, stops: index.stops }))
  .digest("hex")
  .slice(0, 8)
const file = "stop-index-" + hash + ".json"
await rm(OUT_DIR, { recursive: true, force: true })
await mkdir(OUT_DIR, { recursive: true })
await Bun.write(OUT_DIR + "/" + file, json)
const manifest = Schema.encodeUnknownSync(StopsManifest)({
  path: "/data/" + file,
  generatedAt: index.generatedAt,
  count: index.stops.length,
})
await Bun.write(OUT_DIR + "/stops-manifest.json", JSON.stringify(manifest))
console.log("stop index: " + index.stops.length + " entries -> " + OUT_DIR + "/" + file)

// The city network the iOS map draws behind the board: every tram, bus and
// metro line, shared track merged (scripts/lib/lines.ts). Hashed like the
// index, so clients keep it until the network changes.
const table = async (name: string) => iterCsv(await Bun.file(TMP + "/" + name).text())
const lines = buildLines(
  {
    routes: await table("routes.txt"),
    trips: await table("trips.txt"),
    shapes: await table("shapes.txt"),
  },
  index.generatedAt,
)
if (lines.lines.length === 0) throw new Error("GTFS produced no lines")
Schema.decodeUnknownSync(LinesV1)(lines)
const linesHash = createHash("sha256")
  .update(JSON.stringify({ version: lines.version, lines: lines.lines }))
  .digest("hex")
  .slice(0, 8)
const linesFile = "lines-" + linesHash + ".json"
const linesJson = JSON.stringify(lines)
await Bun.write(OUT_DIR + "/" + linesFile, linesJson)
await Bun.write(
  OUT_DIR + "/lines-manifest.json",
  JSON.stringify(
    Schema.encodeUnknownSync(LinesManifest)({
      path: "/data/" + linesFile,
      generatedAt: lines.generatedAt,
      count: lines.lines.length,
    }),
  ),
)
console.log(
  "lines: " +
    lines.lines.length +
    " stretches, " +
    Math.round(linesJson.length / 1e3) +
    " KB -> " +
    OUT_DIR +
    "/" +
    linesFile,
)

// Trip plans, one bucket per route, served by the worker's /api/trips (see
// apps/worker/src/gtfs/buckets.ts). Under OUT_DIR, so they ship as assets.
const buckets = buildTripBuckets({
  trips: await table("trips.txt"),
  stops: parseCsv(await Bun.file(TMP + "/stops.txt").text()),
  stopTimes: await table("stop_times.txt"),
  shapes: await table("shapes.txt"),
})
if (buckets.size === 0) throw new Error("GTFS produced no trip buckets")
let tripCount = 0
let bytes = 0
for (const [key, bucket] of buckets) {
  tripCount += Object.keys(bucket.trips).length
  const body = JSON.stringify(bucket)
  bytes += body.length
  await Bun.write("apps/web/public" + tripBucketPath(key), body)
}
await rm(TMP, { recursive: true, force: true })
console.log(
  "trip plans: " +
    tripCount +
    " trips in " +
    buckets.size +
    " buckets, " +
    Math.round(bytes / 1e6) +
    " MB -> apps/web/public" +
    TRIP_BUCKET_DIR,
)
