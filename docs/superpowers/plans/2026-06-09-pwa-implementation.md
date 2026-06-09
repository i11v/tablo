# tablo PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tablo installable to the Home Screen and launch standalone, with the app shell precached and the stop-search index runtime-cached for offline search — zero Cloudflare Worker changes.

**Architecture:** `vite-plugin-pwa` (Workbox `generateSW`, `registerType: "autoUpdate"`) generates the web manifest + service worker and injects the precache manifest at `vite build`. The `@vite-pwa/assets-generator` integration (`pwaAssets`) produces the icon set from one source SVG and injects the `apple-touch-icon`/favicon/manifest-icon links into the built `index.html` — no committed PNGs. The big stop-index JSON is **excluded from precache** and served via Workbox `runtimeCaching` (CacheFirst for the hash-immutable index, StaleWhileRevalidate for the tiny manifest). `/api/*` is never cached. All output is static files under `packages/web/dist/`, served unchanged by the existing assets binding.

**Tech Stack:** Vite 8, React 19, `vite-plugin-pwa@^1.3.0` (Workbox 7), `@vite-pwa/assets-generator@^1.0.0`, bun, TypeScript 6.

**Spec:** `docs/superpowers/specs/2026-06-09-pwa-design.md`

---

## Notes for the implementer

- **This feature is configuration + static assets, not application logic.** There is no new runtime code to unit-test in the classic TDD sense. The discipline here is a **post-build artifact assertion** (`scripts/verify-pwa.ts`, Task 2) that we write *first*, watch fail (no `dist/sw.js` yet), then make pass by adding the config — plus a manual browser/device pass (Task 9) for things only a real browser can confirm (install prompt, iOS standalone launch, Lighthouse). This mirrors the spec's "Testing" section.
- **Package manager is bun.** Use `bun add -D`, `bun run …`, `bunx …`. Never `npm`/`pnpm`.
- **Build layout.** Root `bun run build` = `build:index` (downloads GTFS, writes `packages/web/public/data/`) then `build:web` (`vite build packages/web`, output → `packages/web/dist/`). The Vite config lives at `packages/web/vite.config.ts` and runs with root = `packages/web`.
- **Fast local loop.** `packages/web/public/data/` is already populated (committed-but-gitignored `stop-index-*.json` + `stops-manifest.json`). So for local iteration run **`bun run build:web`** alone — Vite copies `public/data/**` into `dist/data/**`. You only need `build:index` to refresh GTFS. CI always runs both.
- **Commit convention:** Conventional Commits (`feat`/`build`/`docs`/…), e.g. `feat(web): add PWA manifest + service worker`.
- **Worktree:** if executing in isolation, the worktree should already exist via `superpowers:using-git-worktrees`. Work continues on the branch carrying this plan and the spec.

## File Structure

| Path | Create / Modify | Responsibility |
|---|---|---|
| `packages/web/package.json` | Modify | Add `vite-plugin-pwa` + `@vite-pwa/assets-generator` devDeps |
| `packages/web/vite.config.ts` | Modify | Add `VitePWA({...})` — manifest, Workbox globs + runtimeCaching, `pwaAssets` |
| `packages/web/pwa-assets.config.ts` | Create | Icon generation config (`minimal-2023` preset, source SVG) |
| `packages/web/public/icon.svg` | Create | Single source icon (path-based, on-brand `#08080a`, maskable-safe) |
| `packages/web/src/main.tsx` | Modify | Register the service worker via `virtual:pwa-register` |
| `packages/web/src/vite-env.d.ts` | Create | Ambient types for `virtual:pwa-register` |
| `scripts/verify-pwa.ts` | Create | Post-build assertion: manifest valid, SW present, index not precached |
| `package.json` (root) | Modify | Add `verify:pwa` script |
| `.github/workflows/deploy.yml` | Modify | Run `verify:pwa` after `build:web` |
| `.github/workflows/pr-preview.yml` | Modify | Run `verify:pwa` after `build:web` |

`packages/web/index.html` is **not edited** — the plugin injects the manifest/icon `<link>` tags at build time; hand-adding them would cause drift (spec §2). The existing `<meta name="theme-color" content="#08080a">` stays.

---

### Task 1: Add PWA dev dependencies

**Files:**
- Modify: `packages/web/package.json` (devDependencies)

- [ ] **Step 1: Add the two packages as dev dependencies**

Run (from repo root):

```bash
bun add -D --filter @app/web vite-plugin-pwa @vite-pwa/assets-generator
```

If `--filter` is unavailable in this bun version, run it inside the package:

```bash
cd packages/web && bun add -D vite-plugin-pwa @vite-pwa/assets-generator && cd -
```

- [ ] **Step 2: Verify versions and the Vite 8 peer**

Run:

```bash
grep -E "vite-plugin-pwa|@vite-pwa/assets-generator" packages/web/package.json
```

Expected: both present under `devDependencies`, `vite-plugin-pwa` at `^1.3.0` (or newer) and `@vite-pwa/assets-generator` at `^1.0.0` (or newer). `vite-plugin-pwa@1.3.0` declares `vite: "… || ^8.0.0"` as a peer, matching the repo's `vite@^8`. Confirm install produced no peer-dependency errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/package.json bun.lock
git commit -m "build(web): add vite-plugin-pwa and assets-generator"
```

---

### Task 2: Write the post-build verification script (the failing "test")

**Files:**
- Create: `scripts/verify-pwa.ts`
- Modify: `package.json` (root) — add `verify:pwa` script

- [ ] **Step 1: Add the `verify:pwa` script to root `package.json`**

In the `"scripts"` block of `package.json`, add this line after `"build:web"`:

```json
    "verify:pwa": "bun scripts/verify-pwa.ts",
```

- [ ] **Step 2: Write the verification script**

Create `scripts/verify-pwa.ts`:

```typescript
// Post-build assertion of the PWA artifacts in packages/web/dist.
// Run AFTER `bun run build:web` (or full `bun run build`).
import { existsSync, readFileSync } from "node:fs"

const DIST = "packages/web/dist"
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
if (manifest.name !== "tablo") fail('manifest.name !== "tablo"')
if (manifest.theme_color !== "#08080a") fail("manifest.theme_color wrong")
if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) {
  fail("manifest has no icons[]")
}

// 4. index.html got the injected head links.
const html = readFileSync(DIST + "/index.html", "utf8")
if (!/rel="?apple-touch-icon"?/.test(html)) fail("index.html missing apple-touch-icon link")
if (!/rel="?manifest"?/.test(html)) fail("index.html missing manifest link")

// 5. Service worker wires up the runtime caches but does NOT precache the index.
const sw = readFileSync(DIST + "/sw.js", "utf8")
for (const needle of ["CacheFirst", "StaleWhileRevalidate", "stop-index", "stops-manifest"]) {
  if (!sw.includes(needle)) fail('sw.js missing runtime-cache marker "' + needle + '"')
}
// A precache entry is a quoted literal like "data/stop-index-7b30c225.json".
// (The runtime route's regex appears as \/data\/stop-index- and will NOT match this.)
if (/["']data\/stop-index-[0-9a-f]+\.json["']/.test(sw)) {
  fail("stop-index appears to be PRECACHED (should be runtimeCaching only)")
}

console.log("verify-pwa OK: manifest standalone, icons generated, SW runtime caches present, index not precached")
```

- [ ] **Step 3: Build the web app and run the check — confirm it FAILS**

Run:

```bash
bun run build:web && bun run verify:pwa
```

Expected: `build:web` succeeds (current behaviour, no PWA yet), then `verify:pwa` **FAILS** with `missing packages/web/dist/manifest.webmanifest` (or `sw.js`). This is the red bar — the config in Tasks 3–6 turns it green.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-pwa.ts package.json
git commit -m "test(web): add post-build PWA artifact verification"
```

---

### Task 3: Create the source icon

**Files:**
- Create: `packages/web/public/icon.svg`

> **Rasterization gotcha (important):** the assets generator rasterizes via sharp/librsvg, which uses *system* fonts — it does **not** have the `Doto` web font. Do **not** put a live `<text>` element in this SVG; it would render in a fallback font or not at all. Use vector shapes/paths (as below) or outline any text to paths in a vector editor first. The starter below is a path/rect-only departures-board glyph on the `#08080a` brand background, with all content inside the central 80% safe zone (≈ x/y 51→461 of 512) so the maskable crop is clean.

- [ ] **Step 1: Create the source SVG**

Create `packages/web/public/icon.svg`:

```svg
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="96" fill="#08080a" />
  <!-- split-flap "departures board" rows, all within the 80% safe zone -->
  <g fill="#fafafa">
    <rect x="120" y="150" width="272" height="44" rx="10" />
    <rect x="120" y="234" width="200" height="44" rx="10" fill="#a3a3a3" />
    <rect x="120" y="318" width="240" height="44" rx="10" fill="#a3a3a3" />
  </g>
</svg>
```

> This is a deliberately simple, on-brand placeholder mark — refine the glyph later if desired, but keep it (a) path/rect/shape-only, (b) `#08080a` background, (c) content inside the safe zone. Re-running the build regenerates all derived icons from it.

- [ ] **Step 2: Commit**

```bash
git add packages/web/public/icon.svg
git commit -m "feat(web): add PWA source icon"
```

---

### Task 4: Configure icon generation

**Files:**
- Create: `packages/web/pwa-assets.config.ts`

- [ ] **Step 1: Create the assets-generator config**

Create `packages/web/pwa-assets.config.ts`:

```typescript
import { defineConfig, minimal2023Preset as preset } from "@vite-pwa/assets-generator/config"

export default defineConfig({
  // Inject apple-touch-icon + favicon <link> tags into index.html (2023 head preset).
  headLinkOptions: { preset: "2023" },
  preset,
  images: ["public/icon.svg"],
})
```

The `minimal-2023` preset emits, from `public/icon.svg`: `pwa-64x64.png`, `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`, `apple-touch-icon-180x180.png`, and `favicon.ico`. `headLinkOptions.preset: "2023"` makes the plugin inject the `apple-touch-icon` and favicon links into the built `index.html`.

- [ ] **Step 2: Commit**

```bash
git add packages/web/pwa-assets.config.ts
git commit -m "feat(web): configure PWA icon generation (minimal-2023)"
```

---

### Task 5: Add VitePWA to the Vite config

**Files:**
- Modify: `packages/web/vite.config.ts`

- [ ] **Step 1: Replace the Vite config with the PWA-enabled version**

Replace the entire contents of `packages/web/vite.config.ts` with:

```typescript
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      // Generate the icon set from public/icon.svg and inject the
      // apple-touch-icon / favicon / manifest-icon links (reads pwa-assets.config.ts).
      pwaAssets: { config: true },
      manifest: {
        name: "tablo",
        short_name: "tablo",
        description: "Prague public-transport departures",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#08080a",
        background_color: "#08080a",
        // icons are injected by the pwaAssets integration (see Task 7 verification)
      },
      workbox: {
        // App shell only — NO data/**. (.json is not in this list, so the
        // hashed stop index is never precached.)
        globPatterns: ["**/*.{js,css,html,woff2,svg,png,ico}"],
        // Real-time API is never cached and never navigation-fallback'd.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Hash-immutable stop index -> cache forever; keep the last few hashes.
            urlPattern: /\/data\/stop-index-[^/]+\.json$/,
            handler: "CacheFirst",
            options: {
              cacheName: "stop-index",
              expiration: { maxEntries: 3, maxAgeSeconds: 60 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Tiny pointer -> serve instantly (warm/offline), revalidate in background.
            urlPattern: /\/data\/stops-manifest\.json$/,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "stops-manifest",
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: { "/api": { target: "http://localhost:1337", ws: true } },
  },
})
```

- [ ] **Step 2: Typecheck the config**

Run:

```bash
bun run typecheck
```

Expected: PASS. (If `VitePWA`'s types are missing, re-run Task 1 install.)

- [ ] **Step 3: Commit**

```bash
git add packages/web/vite.config.ts
git commit -m "feat(web): add PWA manifest, service worker, and stop-index runtime caching"
```

---

### Task 6: Register the service worker

**Files:**
- Modify: `packages/web/src/main.tsx`
- Create: `packages/web/src/vite-env.d.ts`

- [ ] **Step 1: Add ambient types for the virtual SW module**

Create `packages/web/src/vite-env.d.ts`:

```typescript
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
```

- [ ] **Step 2: Register the SW in `main.tsx`**

Replace the contents of `packages/web/src/main.tsx` with:

```tsx
import { createRoot } from "react-dom/client"
import { registerSW } from "virtual:pwa-register"
import { App } from "./App.tsx"
import "./styles.css"

// autoUpdate: the new worker takes control silently and applies on the next
// navigation. No prompt UI to build (single-user app).
registerSW({ immediate: true })

createRoot(document.getElementById("root")!).render(<App />)
```

- [ ] **Step 3: Typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS — `virtual:pwa-register` resolves via the `vite-plugin-pwa/client` reference.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/main.tsx packages/web/src/vite-env.d.ts
git commit -m "feat(web): register service worker (autoUpdate)"
```

---

### Task 7: Build and turn the verification green

**Files:** none (runs Task 2's check against the now-PWA build)

- [ ] **Step 1: Build the web app**

Run:

```bash
bun run build:web
```

Expected: build succeeds; `packages/web/dist/` now contains `manifest.webmanifest`, `sw.js`, `workbox-*.js`, `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`, `apple-touch-icon-180x180.png`, `favicon.ico`.

- [ ] **Step 2: Run the verification — confirm it PASSES**

Run:

```bash
bun run verify:pwa
```

Expected: `verify-pwa OK: manifest standalone, icons generated, SW runtime caches present, index not precached`.

If step 5 of the script fails on the manifest having no icons (some plugin versions don't auto-inject `icons[]` into the manifest), add the explicit array to the `manifest` option in `vite.config.ts` (replacing the `// icons are injected…` comment), then rebuild and re-verify:

```typescript
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
```

- [ ] **Step 3: Manually confirm the precache vs. runtime split**

Run:

```bash
grep -o "data/stop-index-[0-9a-f]*\.json" packages/web/dist/sw.js | head
grep -o "\\\\/data\\\\/stop-index" packages/web/dist/sw.js | head
```

Expected: the **first** grep prints **nothing** (no precache entry for the index); the **second** prints the escaped runtime-route regex source (`\/data\/stop-index`). This is the offline-capable-but-not-precached behaviour.

- [ ] **Step 4: Commit (only if you added the explicit icons fallback)**

```bash
git add packages/web/vite.config.ts
git commit -m "fix(web): declare manifest icons explicitly"
```

---

### Task 8: Wire verification into CI

**Files:**
- Modify: `.github/workflows/deploy.yml`
- Modify: `.github/workflows/pr-preview.yml`

- [ ] **Step 1: Add `verify:pwa` after `build:web` in `deploy.yml`**

In `.github/workflows/deploy.yml`, immediately after the `- run: bun run build:web` line, add:

```yaml
      - run: bun run verify:pwa
```

- [ ] **Step 2: Add `verify:pwa` after `build:web` in `pr-preview.yml`**

In `.github/workflows/pr-preview.yml`, immediately after the `- run: bun run build:web` line (in the `preview` job), add:

```yaml
      - run: bun run verify:pwa
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml .github/workflows/pr-preview.yml
git commit -m "ci: verify PWA artifacts after web build"
```

---

### Task 9: Manual browser & device verification

**Files:** none — these confirm behaviours only a real browser/device can show (spec "Testing"). Do them against either a local preview of `dist/` or the PR-preview deploy.

- [ ] **Step 1: Serve the built app locally**

Run (serves `packages/web/dist/`, including `/data/**` as static files):

```bash
bunx vite preview packages/web
```

Open the printed `http://localhost:4173` (or similar). Note: `/api/*` won't respond under `vite preview` (no Worker) — that's fine; live departures are a non-goal for offline and are tested on the preview deploy below.

- [ ] **Step 2: Installability (desktop/Android Chrome)**

DevTools → Application → Manifest: valid, `display: standalone`, icons listed. Application → Service Workers: `sw.js` **activated**. The address bar / menu shows an install affordance ("Installable").

- [ ] **Step 3: Offline stop search**

Load once online. DevTools → Network → check **Offline** → reload. The app shell loads and **stop search still returns results**. Application → Cache Storage shows `stop-index` (the hashed index) and `stops-manifest` entries. The big `stop-index-*.json` is **not** under the Workbox precache cache.

- [ ] **Step 4: Lighthouse**

DevTools → Lighthouse → run the PWA / installability audit against the preview. Expected: installability checks pass.

- [ ] **Step 5: iOS Safari (real device, via PR-preview URL)**

Push the branch and open the PR; the `pr-preview` workflow deploys `https://tablo-pr-<N>.<subdomain>.workers.dev` and comments the URL. On an iPhone, open it in Safari → Share → **Add to Home Screen**: the tile shows the generated icon and "tablo". Launch from the Home Screen → opens **standalone** (no Safari chrome), dark `#08080a` background.

- [ ] **Step 6: Confirm live departures still work (not stale)**

On the preview deploy, confirm `/api/*` departures load fresh (the SW does not cache `/api/*`; `runWorkerFirst` keeps them at the edge).

---

## Spec coverage self-check

- **Installable (iOS A2HS + Android/desktop prompt)** → Tasks 4 (apple-touch-icon), 5 (manifest + SW), 9.2, 9.5. ✓
- **Standalone launch, dark splash** → manifest `display: standalone` + `background_color`/`theme_color: #08080a` (Task 5), verified 9.5. ✓
- **Instant / offline app shell** → Workbox precache via `globPatterns` (Task 5), `autoUpdate` SW registration (Task 6), verified 9.3. ✓
- **Stop-index runtime caching (CacheFirst + SWR), data/ excluded from precache** → Task 5 `runtimeCaching` + glob exclusion, asserted in Tasks 2/7, verified 9.3. ✓
- **`/api/*` never cached** → `navigateFallbackDenylist` + no matching runtimeCaching rule (Task 5), verified 9.6. ✓
- **iOS apple-touch-icon (180×180)** → `minimal-2023` preset + `headLinkOptions: "2023"` (Tasks 3/4), asserted 2/7. ✓
- **Icon generation from one SVG, no committed PNGs** → `pwaAssets` integration emits to `dist/` only; source `icon.svg` committed (Tasks 3–5). ✓
- **Zero Worker changes** → no `packages/worker` edits anywhere in this plan. ✓
- **`vite-plugin-pwa` + `@vite-pwa/assets-generator` as devDeps** → Task 1. ✓
- **Build-artifact + offline + installability + iOS + Lighthouse testing** → Tasks 2/7 (automated) + Task 9 (manual). ✓

**Deviation from spec, noted intentionally:** the spec's §6 floated a standalone `"build:icons": "pwa-assets-generator"` script. This plan instead uses the `vite-plugin-pwa` `pwaAssets: { config: true }` **integration**, which generates icons into the build output and injects the head/manifest links automatically — satisfying the spec's stated preference ("wire generation into the Vite build … without committing generated PNGs") with less moving machinery and no extra CI step beyond the existing `build:web`.
