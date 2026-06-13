// Post-build assertion of the PWA artifacts in packages/web/dist.
// Run AFTER `bun run build:web` (or full `bun run build`).
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

// Resolve relative to this script, so `bun scripts/verify-pwa.ts` works from any cwd.
const DIST = resolve(import.meta.dir, "../packages/web/dist")
const fail = (msg: string): never => {
  console.error("verify-pwa FAIL: " + msg)
  process.exit(1)
}

// 1. Core artifacts exist.
for (const f of ["manifest.webmanifest", "sw.js", "index.html"]) {
  if (!existsSync(DIST + "/" + f)) fail("missing " + DIST + "/" + f)
}

// 2. Generated icon set exists (minimal-2023 preset names).
for (const f of [
  "pwa-192x192.png",
  "pwa-512x512.png",
  "maskable-icon-512x512.png",
  "apple-touch-icon-180x180.png",
  "favicon.ico",
]) {
  if (!existsSync(DIST + "/" + f)) fail("missing generated icon " + f)
}

// 3. Manifest is a standalone, correctly-named app with >=1 icon.
const manifest = JSON.parse(readFileSync(DIST + "/manifest.webmanifest", "utf8"))
if (manifest.display !== "standalone") fail('manifest.display !== "standalone"')
if (manifest.name !== "tablo.") fail('manifest.name !== "tablo."')
if (manifest.theme_color !== "#08080a") fail("manifest.theme_color wrong")
if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) {
  fail("manifest has no icons[]")
}

// 4. index.html got the injected head links.
const html = readFileSync(DIST + "/index.html", "utf8")
if (!/rel="?apple-touch-icon"?/.test(html)) fail("index.html missing apple-touch-icon link")
if (!/rel="?manifest"?/.test(html)) fail("index.html missing manifest link")

// 5. Service worker wires up the runtime caches but does NOT precache the index.
// Assert on the cacheName string LITERALS only. Workbox preserves these verbatim,
// and they appear solely because of our runtimeCaching config (the hashed index is
// excluded from precache). Do NOT assert on the strategy class names CacheFirst /
// StaleWhileRevalidate: those are imported bindings the production minifier renames
// or inlines, so the literal text need not survive a correct build. Strategy
// *flavour* (CacheFirst vs SWR) isn't observable in minified output anyway — it's
// verified manually via DevTools Cache Storage in Task 9, Step 3.
const sw = readFileSync(DIST + "/sw.js", "utf8")
for (const needle of ["stop-index", "stops-manifest", "google-fonts-css", "google-fonts-files"]) {
  if (!sw.includes(needle)) fail('sw.js missing runtime cache "' + needle + '"')
}
// A precache entry is a quoted literal like "data/stop-index-7b30c225.json".
// (The runtime route's regex appears as \/data\/stop-index- and will NOT match this.)
if (/["']data\/stop-index-[0-9a-f]+\.json["']/.test(sw)) {
  fail("stop-index appears to be PRECACHED (should be runtimeCaching only)")
}

console.log("verify-pwa OK: manifest standalone, icons generated, SW runtime caches present, index not precached")
