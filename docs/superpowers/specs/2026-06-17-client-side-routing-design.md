# tablo client-side routing — design

**Date:** 2026-06-17
**Status:** implemented (PR #17)
**Reference:** `2026-06-01-prague-departures-spa-design.md` (SPA shell),
`2026-06-08-tablo-deploy-automation-design.md` (assets binding / SPA fallback),
`2026-06-09-pwa-design.md` (service worker / precache)

## Goal

Introduce **client-side routing** so the app can grow beyond the single
departures board into multiple pages, without adopting SSR. Pure frontend:
the existing Cloudflare Worker keeps serving a static SPA, the router runs
entirely in the browser. Adding a new page should be a local, low-ceremony
change — ideally "drop a file in `src/routes/`".

- **Multiple pages** — a real route table the app can extend.
- **No SSR** — the worker serves static assets only; no server-rendered HTML,
  no per-route worker logic.
- **Deep-linkable** — a direct hit on a future route URL loads the app and
  resolves to that route.
- **Zero behaviour change to the board** — the departures page and its `?s=`
  share links work exactly as before.

### Non-goals (v1)

- SSR / streaming / server functions.
- Migrating the board's `?s=` selection state into typed router search params
  (a clean follow-up — see "Selection state" below).
- Auth-gated routes, loaders that fetch data, route-level error boundaries
  (added per-page when a page actually needs them).
- Any `packages/worker` change.

## Background: what a pure-SPA router needs

- **The server must fall back to `index.html`** for unknown paths, or a deep
  link / refresh on a client route 404s. tablo's worker **already** does this:
  the Cloudflare assets binding is configured with
  `notFoundHandling: "single-page-application"` and
  `runWorkerFirst: ["/api/*", "/data/*"]` (`packages/worker/src/index.ts`).
  `/api/*` and `/data/*` are handled worker-first; **everything else** gets the
  SPA fallback. So new client routes resolve with **no worker change**.
- **Browser history, not hash routing** — clean URLs, and the fallback above
  makes them safe to deep-link.
- **The route tree must exist at typecheck time.** CI runs `tsc -p packages/web`
  *without* invoking Vite (`bun run typecheck`), so a Vite-plugin-generated
  route tree has to be **committed**, not produced on the fly.
- **Devtools must not ship to production** — they are a dev-only aid.

## Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Router | **TanStack Router** (`@tanstack/react-router`) | Type-safe routes/params/search, first-class file-based routing, no SSR requirement, healthy React 19 support. |
| Route definition | **File-based** routing (`@tanstack/router-plugin/vite`) | A new page = a new file in `src/routes/`. Matches the "introduce new pages" goal with the least ceremony; the plugin generates a fully-typed tree. |
| Generated tree | **Commit `routeTree.gen.ts`** | CI's `tsc` runs without Vite, so the tree must exist on disk to typecheck. Also keeps diffs reviewable. |
| Plugin order | `tanstackRouter()` **before** `react()` in `vite.config.ts` | The route tree must be generated before React/Fast-Refresh transforms the route modules. |
| Code splitting | `autoCodeSplitting: true` | Each route's component is split into its own chunk automatically — pages added later don't bloat the initial bundle. |
| History mode | **Browser history** (TanStack default) | Clean URLs; safe because of the existing SPA fallback. No hash routing. |
| Root layout | Thin `<Outlet />` shell (`__root.tsx`) | The board still owns its own chrome (AppBar/SubBar); the root stays minimal until shared cross-page layout is actually needed. |
| Devtools | Lazy + `import.meta.env.PROD`-stubbed | Tree-shaken out of the production bundle; available in dev only. |
| Board selection (`?s=`) | **Left as an unvalidated search param** | TanStack Router preserves search params it doesn't validate, so the board's existing `history.replaceState`-based share links keep working untouched. Migration is a separate, optional follow-up. |

## Architecture

```
vite build
  ├─ tanstackRouter() plugin  ──> generates src/routeTree.gen.ts from src/routes/
  │                               (committed; regenerated on dev/build)
  └─ react(), tailwindcss(), VitePWA()  (unchanged)

src/main.tsx
  createRouter({ routeTree })  ──> <RouterProvider />
        │
        └─ routeTree (generated)
             ├─ __root.tsx   <Outlet/> + dev-only devtools
             └─ index.tsx    "/"  ──> existing <App/> (departures board)

browser GET /<any client route>
  └─ worker: not /api/* or /data/*  ──> assets binding SPA fallback ──> index.html
       └─ TanStack Router resolves the path client-side
```

## Components

### 1. `packages/web/vite.config.ts`

Add `tanstackRouter({ target: "react", autoCodeSplitting: true })` to `plugins`,
**before** `react()`. Defaults are kept: routes in `./src/routes`, generated
tree at `./src/routeTree.gen.ts`.

### 2. `packages/web/src/routes/__root.tsx`

`createRootRoute({ component: RootLayout })`. `RootLayout` renders `<Outlet />`
plus the router devtools, which are `lazy()`-loaded and stubbed to `() => null`
under `import.meta.env.PROD` so they never reach the production bundle.

### 3. `packages/web/src/routes/index.tsx`

`createFileRoute("/")({ component: App })` — renders the existing departures
`App` unchanged. New pages are added as sibling files (e.g. `about.tsx` → `/about`,
`stops.$id.tsx` → `/stops/:id`).

### 4. `packages/web/src/main.tsx`

`createRouter({ routeTree })` from the generated tree, the typed
`declare module "@tanstack/react-router" { interface Register { router: typeof router } }`
registration, and `<RouterProvider router={router} />` in place of the old
`<App />`. SW registration (`virtual:pwa-register`) is unchanged.

### 5. `packages/web/src/routeTree.gen.ts`

Generated by the plugin, **committed**. Carries `// @ts-nocheck` and
`eslint-disable` headers; not hand-edited.

### Selection state (`?s=`) — current handling and future path

The board persists its stop selection in the `?s=` query param via
`history.replaceState` (`packages/web/src/lib/storage.ts`) and restores it in
`loadSelection`. TanStack Router **preserves search params it does not
validate**, and its history integration observes the `replaceState` calls, so
this keeps working with no change. A future cleanup could move `s` into the
index route's `validateSearch` for a typed, router-owned API — deliberately out
of scope here to keep this PR a pure routing scaffold.

## Testing

- **Typecheck:** `bun run typecheck` — passes (route tree committed, so `tsc`
  resolves `routeTree.gen.ts` without Vite).
- **Unit tests:** `bun run test` — 70/70 unchanged (no app logic touched).
- **Build:** `vite build` — succeeds; the devtools bundle is excluded from the
  production output, and route components are split into their own chunk.
- **Deep link / fallback:** a preview deploy serves a direct hit on a client
  route via the SPA fallback (`index.html`), which the router then resolves.
- **CI / preview:** PR #17 `preview` job green end-to-end (typecheck, test,
  build, `verify:pwa`, Cloudflare deploy, `/api/health` smoke test).

## Backward compatibility

Additive and frontend-only. The worker, assets binding, SPA fallback,
`/api/*` and `/data/*` routing, and the PWA service worker are all unchanged.
The departures board renders identically and its `?s=` share links are
preserved. No new worker code, no deploy changes.

## Out of scope

- SSR, server functions, route loaders/actions.
- Migrating `?s=` selection into typed router search params.
- Shared cross-page layout/navigation chrome (added when a second page lands).
- Auth-gated routes and route-level error boundaries.
