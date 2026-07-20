import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { $ } from "bun"
import { Schema } from "effect"
import { RoutesAsset, StopIndexV2, StopsManifest, type RouteInfo } from "@app/contract"
import { parseCsv } from "./lib/csv.ts"
import { buildIndex } from "./lib/build.ts"
import { indexGtfsStops, nodeRoutes, parseRoutes, parseTrips } from "./lib/gtfs.ts"
import { collectShapes, pickShapeIds } from "./lib/shapes.ts"
import { simplify } from "./lib/simplify.ts"

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
const routeMeta = parseRoutes(parseCsv(await Bun.file(TMP + "/routes.txt").text()))
const trips = parseTrips(await Bun.file(TMP + "/trips.txt").text())
const nodeRouteMap = nodeRoutes(
  await Bun.file(TMP + "/stop_times.txt").text(),
  trips,
  indexGtfsStops(rows),
)
const routeTypes = new Map([...routeMeta].map(([id, m]) => [id, m.type] as const))
const index = buildIndex(rows, new Date().toISOString(), nodeRouteMap, routeTypes)
Schema.decodeUnknownSync(StopIndexV2)(index) // fail loudly on schema drift

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

// Route + shape assets: only routes that serve an indexed node, one hashed
// shape file per route (representative shape per direction, simplified).
const SIMPLIFY_TOLERANCE = 0.0001 // ≈10 m at Prague latitude — below drawn line width
const servedRoutes = new Set<string>()
for (const set of nodeRouteMap.values()) for (const id of set) servedRoutes.add(id)
const picked = pickShapeIds(trips)
for (const [shapeId, routeId] of picked) {
  if (!servedRoutes.has(routeId)) picked.delete(shapeId)
}
const shapePoints = collectShapes(await Bun.file(TMP + "/shapes.txt").text(), picked)
const segmentsByRoute = new Map<string, Array<Array<[number, number]>>>()
for (const [shapeId, routeId] of picked) {
  const pts = shapePoints.get(shapeId)
  if (pts === undefined || pts.length < 2) continue
  const segs = segmentsByRoute.get(routeId) ?? []
  segs.push(simplify(pts, SIMPLIFY_TOLERANCE))
  segmentsByRoute.set(routeId, segs)
}
await mkdir(OUT_DIR + "/shapes", { recursive: true })
const routesAsset: Array<RouteInfo> = []
for (const id of [...servedRoutes].sort()) {
  const meta = routeMeta.get(id)
  if (meta === undefined) continue
  const shapeJson = JSON.stringify({
    routeId: id,
    color: meta.color,
    coords: segmentsByRoute.get(id) ?? [],
  })
  const shapeHash = createHash("sha256").update(shapeJson).digest("hex").slice(0, 8)
  const shapeFile = "shapes/" + id + "-" + shapeHash + ".json"
  await Bun.write(OUT_DIR + "/" + shapeFile, shapeJson)
  routesAsset.push({
    id,
    shortName: meta.shortName,
    color: meta.color,
    textColor: meta.textColor,
    type: meta.type,
    shapePath: "/data/" + shapeFile,
  })
}
Schema.decodeUnknownSync(RoutesAsset)(routesAsset) // fail loudly on schema drift
const routesJson = JSON.stringify(routesAsset)
const routesHash = createHash("sha256").update(routesJson).digest("hex").slice(0, 8)
const routesFile = "routes-" + routesHash + ".json"
await Bun.write(OUT_DIR + "/" + routesFile, routesJson)

const manifest = Schema.encodeUnknownSync(StopsManifest)({
  path: "/data/" + file,
  generatedAt: index.generatedAt,
  count: index.stops.length,
  routesPath: "/data/" + routesFile,
})
await Bun.write(OUT_DIR + "/stops-manifest.json", JSON.stringify(manifest))
await rm(TMP, { recursive: true, force: true })
console.log("stop index: " + index.stops.length + " entries -> " + OUT_DIR + "/" + file)
console.log("routes: " + routesAsset.length + " -> " + OUT_DIR + "/" + routesFile)
