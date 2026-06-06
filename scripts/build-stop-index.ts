import { createHash } from "node:crypto"
import { mkdir, rm } from "node:fs/promises"
import { $ } from "bun"
import { Schema } from "effect"
import { StopIndexV1, StopsManifest } from "@app/contract"
import { parseCsv } from "./lib/csv.ts"
import { buildIndex } from "./lib/build.ts"

const GTFS_URL = "https://data.pid.cz/PID_GTFS.zip"
const TMP = ".alchemy/tmp-gtfs"
const OUT_DIR = "packages/web/public/data"

const res = await fetch(GTFS_URL)
if (!res.ok) throw new Error("GTFS download failed: " + res.status)
await rm(TMP, { recursive: true, force: true })
await mkdir(TMP, { recursive: true })
await Bun.write(TMP + "/PID_GTFS.zip", res)
await $`unzip -o ${TMP}/PID_GTFS.zip stops.txt -d ${TMP}`.quiet()

const rows = parseCsv(await Bun.file(TMP + "/stops.txt").text())
const index = buildIndex(rows, new Date().toISOString())
Schema.decodeUnknownSync(StopIndexV1)(index) // fail loudly on schema drift

const json = JSON.stringify(index)
const hash = createHash("sha256").update(json).digest("hex").slice(0, 8)
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
