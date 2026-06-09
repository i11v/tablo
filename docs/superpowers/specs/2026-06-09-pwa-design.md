# tablo PWA — design

**Date:** 2026-06-09
**Status:** approved (design); pending spec review
**Reference:** `2026-06-08-platform-level-stop-selection-design.md` (stop index),
`2026-06-08-tablo-deploy-automation-design.md` (assets binding / deploy)

## Goal

Make tablo installable to the phone Home Screen and launch **standalone** (no
Safari/Chrome chrome), with the app shell precached for instant, offline-capable
loads. The stop search index is cached so search works on a cold network. Zero
Cloudflare Worker changes; minimal bundle impact.

- **Installable** — Add to Home Screen on iOS Safari and the install prompt on
  Android/desktop Chrome.
- **Standalone launch** — opens like a native app, dark splash matching the UI.
- **Instant / offline shell** — app HTML/JS/CSS precached; stop search works
  offline after the first visit.

### Non-goals (v1)

- Offline **departures** — real-time data is stale the moment it's cached; the
  departures API is never cached.
- Push notifications, background sync, periodic background refresh.
- iOS splash-screen image set (per-device launch images) — optional later.
- Self-hosting fonts for a fully offline-styled shell (system-font fallback is
  acceptable offline).

## Background: what mobile Safari actually needs

Researched 2026-06; the relevant facts that shape this design:

- **iOS Safari supports** Add-to-Home-Screen → standalone launch. It **ignores**
  the manifest `icons` array and instead uses
  `<link rel="apple-touch-icon" href="…">` (180×180 PNG) from the page `<head>`.
- A **service worker is not required** for iOS install, but **is** required for
  the Android/desktop Chrome install prompt and for any app-shell / data caching.
- A valid **`manifest.webmanifest`** with `display: "standalone"` is still
  recommended (and as of iOS 26 every Home-Screen site opens as a web app, so a
  clean manifest only helps).
- **No backend special-casing.** The Cloudflare assets binding already serves
  `packages/web/dist` with `notFoundHandling: "single-page-application"` and
  `runWorkerFirst: ["/api/*"]`. The manifest, `sw.js`, and icons are just static
  files in `dist/`, served with correct MIME types; the SW registers at root
  scope, which the assets binding supports. **No `packages/worker` changes.**

Sources: web.dev *Web App Manifest*, MDN *Making PWAs installable*, firt.dev
*iOS PWA compatibility*.

## Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Tooling | **`vite-plugin-pwa`** (generateSW / Workbox) | Generates manifest + SW, injects the precache manifest automatically, integrates with `vite build`. No hand-rolled SW. |
| Update strategy | **`registerType: "autoUpdate"`** | Single-user app — silently activate the new SW; app-shell changes apply on the next load. No update-prompt UI to build. |
| iOS icon | Explicit **`apple-touch-icon` (180×180)** in `index.html` head | Safari ignores the manifest icons; without this the Home-Screen icon is a blurry screenshot. |
| Icon generation | **`@vite-pwa/assets-generator`** from one source SVG | Produces 192 / 512 / maskable + apple-touch-icon + favicon and injects the head tags; reproducible, no manual image editing. |
| Precache scope | Workbox `globPatterns` = JS/CSS/HTML/font/icon only; **exclude `data/**`** | Precache is atomic — any app change re-downloads the whole set. The hashed stop index gains nothing from precache and would bloat it. |
| Stop-index caching | Workbox **`runtimeCaching`** (CacheFirst + StaleWhileRevalidate) | Index is large, fetched on every start, and immutable-by-hash — ideal for runtime caching. Enables offline stop search. See §3. |
| Departures / API | **Not cached** | Real-time; `runWorkerFirst: ["/api/*"]` keeps `/api/*` off the SW cache entirely. |

## Architecture

```
vite build (with VitePWA)
  ├─ index.html  (+ injected manifest / apple-touch-icon links)
  ├─ assets/*.js .css            ─┐
  ├─ icons (192/512/maskable,     ├─ precached (Workbox precache manifest)
  │   apple-touch-icon, favicon) ─┘
  ├─ manifest.webmanifest         ─ served static, linked from <head>
  ├─ sw.js + workbox-*.js         ─ registered at "/" scope from main.tsx
  └─ data/stop-index-<hash>.json  ─ NOT precached → runtimeCaching (§3)
     data/stops-manifest.json

alchemy deploy → uploads packages/web/dist/ to the assets binding UNCHANGED
                 (no worker code changes)

browser → GET /manifest.webmanifest, register /sw.js at root scope
```

## Components

### 1. `packages/web/vite.config.ts`

Add `VitePWA({...})` to `plugins` (alongside `react()` and `tailwindcss()`):

- `registerType: "autoUpdate"`.
- `manifest`: `name: "tablo"`, `short_name: "tablo"`, `start_url: "/"`,
  `scope: "/"`, `display: "standalone"`, `theme_color: "#08080a"`,
  `background_color: "#08080a"`, and the generated `icons` (192, 512, and a
  512 `purpose: "maskable"`).
- `workbox.globPatterns`: `["**/*.{js,css,html,woff2,svg,png,ico}"]` —
  **without** `data/**`.
- `workbox.runtimeCaching` (see §3).
- `includeAssets`: the apple-touch-icon + favicon so they ship to `dist/`.

### 2. `packages/web/index.html`

- Add `<link rel="apple-touch-icon" href="/apple-touch-icon.png" />` and the
  manifest link (or rely on `vite-plugin-pwa` injection — prefer the plugin's
  injected tags to avoid drift).
- Keep the existing `<meta name="theme-color" content="#08080a" />`.
- Google Fonts stay remote (`<link>` to fonts.googleapis.com) — **not**
  precached; offline falls back to system fonts. Acceptable for v1.

### 3. Stop-index runtime caching

The stop index (`packages/web/src/hooks/useStopIndex.ts`) is fetched on **every
app start** and **blocks** the search UI. It is **~9k entries / ~0.5–1.5 MB**,
loaded in two stages: `GET /data/stops-manifest.json` (tiny pointer) →
`GET /data/stop-index-<hash>.json` (content-hashed, immutable). Rebuilt every
deploy (`scripts/build-stop-index.ts`), but the underlying GTFS changes rarely.

Two `runtimeCaching` rules:

| URL pattern | Strategy | Options |
|---|---|---|
| `/data/stop-index-*.json` | **CacheFirst** | `expiration: { maxEntries: 3, maxAgeSeconds: 60d }` — hash-immutable, so cache forever; `maxEntries` purges superseded hashes |
| `/data/stops-manifest.json` | **StaleWhileRevalidate** | serves instantly (warm / offline), revalidates in the background |

Behaviour: warm starts are instant and **stop search works offline** after the
first visit. After a deploy the StaleWhileRevalidate manifest picks up the new
hash in the background, and the new index loads on the *next* visit — one load
late, consistent with `autoUpdate`. No re-download on unrelated app deploys.

### 4. SW registration — `packages/web/src/main.tsx`

Import the plugin's virtual `registerSW` (`virtual:pwa-register`) and call it
with `immediate: true`. With `autoUpdate` there is no prompt UI; the new worker
takes control and applies on the next navigation.

### 5. Icons — source + generation

- One source `packages/web/public/icon.svg`: the tablo wordmark/glyph (Doto) on
  the `#08080a` background, with the critical mark inside the central 80% safe
  zone (for the maskable variant).
- `@vite-pwa/assets-generator` config (preset `minimal-2023`) emits
  `pwa-192x192.png`, `pwa-512x512.png`, `pwa-maskable-512x512.png`,
  `apple-touch-icon.png` (180×180), and `favicon.ico`, and injects the matching
  head tags.

### 6. `package.json`

- Add `vite-plugin-pwa` and `@vite-pwa/assets-generator` as **devDependencies**.
- Add `"build:icons": "pwa-assets-generator"` and run it before `build:web`
  (locally and in CI), or wire generation into the Vite build — whichever keeps
  the icon set reproducible without committing generated PNGs.

## Testing

- **Build artifacts:** `bun run build` → `dist/manifest.webmanifest`,
  `dist/sw.js`, and the icon set exist. Confirm `dist/data/**` is **not** in the
  precache manifest but **is** matched by a `runtimeCaching` rule in `sw.js`.
- **Offline stop search:** load the app online, then DevTools → Network
  "Offline" → reload → stop search still works; Cache Storage holds the hashed
  index + manifest entries.
- **Installability (desktop/Android):** `alchemy dev` or a preview deploy →
  DevTools → Application: manifest valid, SW activated, "Installable".
- **iOS Safari (real device / preview URL):** Share → Add to Home Screen shows
  the generated icon and "tablo"; launching opens standalone (no Safari chrome).
- **Lighthouse:** PWA / installability audit passes.

## Backward compatibility

Purely additive. The assets binding, SPA fallback, and `/api/*` routing are
unchanged; `/api/*` is excluded from the SW (it's `runWorkerFirst`), so live
departures are never served stale. Browsers without SW support simply skip
caching and run as today.

## Out of scope

- Offline departures / API caching.
- Push notifications, background sync.
- Per-device iOS splash-screen image set (optional later via the assets
  generator).
- Self-hosting fonts for a fully offline-styled shell.
