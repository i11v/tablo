# Deploying tablo

CI-owned [Alchemy](https://github.com/alchemy-run/alchemy) deploys to Cloudflare.
Everything specific to deploying tablo is below.

A deploy ships the **backend** (the worker: HTTP API, `/api/ws`, Durable
Objects) and the **web client** it serves as static assets — nothing else. The
iOS app (`ios/`), the primary client, isn't deployed: it's built and installed
from Xcode (see [`ios/README.md`](../ios/README.md)) and has its own CI
workflow, `.github/workflows/ios.yml` (`xcodegen generate` + `xcodebuild test`
on changes under `ios/`). Neither deploy workflow builds it. It does run on the
deployed API, though — see [iOS compatibility](#ios-compatibility).

## Live URLs

| What | URL |
|------|-----|
| Production (custom domain) | https://tablo.run |
| Production (workers.dev) | https://tablo.i11v.workers.dev |
| PR preview (custom domain) | https://preview-`<N>`.tablo.run (posted as a sticky PR comment) |
| PR preview (workers.dev) | https://tablo-pr-`<N>`.i11v.workers.dev (comment fallback) |

Both production URLs serve the same worker; the custom domain is in addition to
the workers.dev one, not a replacement. Same for previews — each PR gets its own
`preview-<N>.tablo.run` hostname *and* keeps its workers.dev URL via `url: true`.

## How a deploy happens

| Trigger | Workflow | Command | Result |
|---------|----------|---------|--------|
| push to `main` | `.github/workflows/deploy.yml` | `alchemy deploy --stage production` | worker **`tablo`** |
| open / sync a PR | `.github/workflows/pr-preview.yml` | `alchemy deploy --stage pr-<N>` | worker **`tablo-pr-<N>`** + URL comment |
| close a PR | `pr-preview.yml` (cleanup job) | `alchemy destroy --stage pr-<N>` | preview removed |

`deploy.yml` has **no path filter** — *every* push to `main` redeploys
production (idempotent; docs-only merges re-upload the same bundle).

Each CI run, before deploying:
`bun install --frozen-lockfile` → `lint` → `fmt:check` → `typecheck` → `test`
→ build the GTFS stop index (`build:index`) → build the web app (`build:web`) →
`verify:pwa` → deploy → **smoke test**. The smoke test polls `/api/health` for
up to ~72 s and fails unless it reports the exact commit SHA just deployed (a
plain 200 isn't enough — the previous build's health endpoint also answers 200).

## Required GitHub config (repo `i11v/tablo`)

**Secrets:**
- `CLOUDFLARE_API_TOKEN` — needs **Workers** edit **and Secrets Store** (Read+Edit)
  scope, because state lives in `Cloudflare.state()` (an encryption key in
  Secrets Store). Without the Secrets Store scope the deploy can't read/write
  its state store and fails.
- `CLOUDFLARE_ACCOUNT_ID`
- `GOLEMIO_API_TOKEN` — the Prague transit (Golemio) API key the worker needs at
  runtime.

**Variable:**
- `CF_WORKERS_SUBDOMAIN = i11v` — the account's workers.dev subdomain. Only used
  to build the smoke-test and preview-comment URLs; both workflows fail fast if
  it's unset. (It really is `i11v`, not the older `ilnur-khalilov`.)

## The stop index (`build:index`)

`build:index` downloads the public Prague GTFS feed (~48 MB, `data.pid.cz`, **no
token**) and writes a hashed stop index into `packages/web/public/data/`, which
is **gitignored** — it's a build artifact, never committed, regenerated every
deploy. CI caches the feed (`actions/cache`) so a `data.pid.cz` outage can't
block a deploy. Both clients load it through `/data/stops-manifest.json`, which
points at the current hashed file.

## iOS compatibility

The iOS app talks to production by default, and installed builds don't update
when the backend does (no App Store — a build stays on a phone until it's
reinstalled). The app reads the stop index, `/api/ws`, `/api/trips/:tripId`,
`/api/trips/:tripId/vehicle` and `/api/vehicles`, and mirrors their shapes by
hand in `ios/Tablo/API/Wire.swift` (no codegen). So changes to
`packages/contract` must be backward compatible: adding a field is safe (both
Effect Schema and Swift `Decodable` ignore unknown keys); renaming, removing or
retyping one breaks installed builds. To try a backend change on a phone before
merge, bake the PR preview into a build (`TABLO_API_BASE=https://preview-<N>.tablo.run`,
see [`ios/README.md`](../ios/README.md#pointing-at-another-backend)).

Two checks hold the contract in place, both generated from the Effect schemas
by `bun run contract:write` (commit what it writes):

- **`packages/contract/wire-shape.json`** lists every field the clients see or
  send — HTTP API (from its OpenAPI), `/api/ws` and the stop index — with the
  JSON forms it can take. `.github/workflows/contract.yml` runs
  `bun run contract:check` on PRs touching the contract and fails on a change
  that breaks an installed build: a response field removed, retyped, or newly
  null/absent/given a new enum value; a request form the server stops
  accepting; a new required request field. Additions pass. The
  `contract-break` PR label skips it for a break the app provably tolerates.
  It sees types, not refinements (a tightened range or max length isn't
  flagged).
- **`ios/TabloTests/ContractFixtures/*.json`** are sample payloads encoded by
  the schemas (`scripts/lib/wire-fixtures.ts`), which `ContractTests.swift`
  decodes, asserting every value. A wire change regenerates them, so it runs
  the iOS workflow — the current app must read what the backend now sends.

`bun run test` fails when either file is out of date, or when the samples
don't show every field in every form (a nullable field both null and set).

## Custom domains (`tablo.run`)

Attached via the worker's `domain` prop in `packages/worker/src/index.ts`. The
hostname is derived from the stage by `workerDomain()` in `workerName.ts`:

```ts
// workerName.ts
export const workerDomain = (stage: string): string | undefined => {
  if (stage === "production") return "tablo.run"          // apex
  const pr = /^pr-(\d+)$/.exec(stage)
  return pr ? `preview-${pr[1]}.tablo.run` : undefined     // per-PR preview
}

// index.ts
...(WORKER_DOMAIN ? { domain: WORKER_DOMAIN } : {}),
```

- The `tablo.run` zone already exists in the account, so Cloudflare
  auto-provisions the proxied DNS record + TLS cert on deploy — no dashboard or
  DNS steps. `preview-<N>.tablo.run` subdomains are covered by Universal SSL's
  `*.tablo.run`.
- Production is the apex `tablo.run`; each PR preview gets its own
  `preview-<N>.tablo.run`, so previews can never collide with — or grab —
  production's hostname.
- **Don't hand-add domains in the Cloudflare dashboard** — Alchemy reconciles the
  worker's domains against the `domain` prop and would remove anything extra.
- **Apex caveat:** Workers Custom Domains *create* the apex DNS record. Make sure
  `tablo.run` has no conflicting proxied A/AAAA/CNAME at the apex (a parking
  record) before the first prod deploy, or the attach fails.

### Custom-domain teardown (formerly the `@distilled.cloud/core` patch)

Deleting a Workers custom domain (preview teardown on PR close, or production
switching to a new domain) used to hit a beta CF-client bug: Cloudflare answers
the `DELETE …/workers/domains/{id}` with an empty `200`, the old client failed
to decode it, and the whole `deploy`/`destroy` aborted with the misleading
`CloudflareHttpError: null`. We carried a `bun patch` against
`@distilled.cloud/core@0.29.1` for it
([alchemy-run/distilled#344](https://github.com/alchemy-run/distilled/pull/344)).
Since alchemy `2.0.0-beta.80` (distilled `1.0.0-rc.13`) the Cloudflare protocol
parses an empty 2xx body as `{}`, so the patch was dropped; the first preview
teardown on the new stack (#34) deleted its custom domain cleanly. If the
`CloudflareHttpError: null` abort ever comes back, the DELETE still *succeeds*
server-side, so a failed teardown completes on a plain
`gh run rerun <id> --failed`.

## tablo-specific footguns

Two that bite this project hardest:

1. **Stage name must come from `process.env.TABLO_STAGE`, read at module load —
   never from the `Alchemy.Stage` service.** The worker derives its name (and its
   custom hostname, via `workerDomain`) from `WORKER_STAGE` in
   `packages/worker/src/index.ts`.
   Reading `Alchemy.Stage` inside the worker definition leaks a deploy-only
   `Context` requirement into the *runtime*, so every `/api/*` request crashes
   with `Service not found: Stage` → Cloudflare **1101** (static assets still
   serve, so it looks half-alive). Both workflows set `TABLO_STAGE` to match
   `--stage`.

2. **Never `alchemy deploy --stage production` from a laptop.** State is shared
   (`Cloudflare.state()`); a local deploy writes an absolute `dist` path into it
   and the next CI run fails with `NotFound: …/dist`. CI owns all deploys.
   `alchemy.run.ts` also has a **plan-time guard** that dies before touching any
   resource if `TABLO_STAGE` ≠ `--stage`, so a stray manual deploy can't rename
   and thereby replace the live `tablo` worker. And `destroy` has **no** local
   flag — `destroy --stage production` would delete the live worker; don't run it.

Note: `GOLEMIO_API_TOKEN` is **not** a Secrets Store binding — Alchemy bakes the
`Config.redacted("GOLEMIO_API_TOKEN")` value into the worker's `props.env` at
plan time. The worker reads it on boot (or dies), so a green `/api/health` proves
the secret binding works end-to-end.

## Local development

- `bun run dev` (= `alchemy dev`). Static-asset serving is broken in local dev
  (upstream Cloudflare-runtime bug) — use a `vite dev` proxy for SPA work; prod
  is unaffected.
- Local runtime secret: `GOLEMIO_API_TOKEN` in `.env` (gitignored).
- To reset local dev state, **don't** `alchemy destroy` (it hits the real
  Cloudflare API) — `rm -rf .alchemy/local/*<DurableObjectName>*` instead.
