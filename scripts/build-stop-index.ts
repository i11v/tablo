import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { $ } from "bun"
import { Schema } from "effect"
import { StopIndexV1, StopsManifest } from "@app/contract"
import { parseCsv } from "./lib/csv.ts"
import { buildIndex } from "./lib/build.ts"

const GTFS_URL = "https://data.pid.cz/PID_GTFS.zip"
const TMP = ".alchemy/tmp-gtfs"
const OUT_DIR = "packages/web/public/data"
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
      ") — falling back to cached " + CACHE_ZIP,
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
await $`unzip -o ${CACHE_ZIP} stops.txt -d ${TMP}`.quiet()

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
await rm(TMP, { recursive: true, force: true })
console.log("stop index: " + index.stops.length + " entries -> " + OUT_DIR + "/" + file)
