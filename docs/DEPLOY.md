# Deploying tablo

CI-owned [Alchemy](https://github.com/alchemy-run/alchemy) deploys to Cloudflare.
Everything specific to deploying tablo is below.

A deploy ships the **backend** (the worker: HTTP API, `/api/ws`, Durable
Objects) and the **web client** it serves as static assets — nothing else. The
iOS app (`apps/ios/`), the primary client, isn't deployed: it's built and installed
from Xcode (see [`apps/ios/README.md`](../apps/ios/README.md)) and has its own CI
workflow, `.github/workflows/ios.yml` (`xcodegen generate` + `xcodebuild test`
on changes under `apps/ios/`). Neither deploy workflow builds it. It does run on the
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
| daily 03:30 UTC (or manual) | `.github/workflows/deploy.yml` | same | refreshes the GTFS-built data (stop index, trip plans) |
| open / sync a PR | `.github/workflows/pr-preview.yml` | `alchemy deploy --stage pr-<N>` | worker **`tablo-pr-<N>`** + URL comment |
| close a PR | `.github/workflows/preview-cleanup.yml` | `alchemy destroy --stage pr-<N>` | preview removed |
| daily 05:17 UTC (or manual) | `preview-cleanup.yml` | same, for every `tablo-pr-<N>` whose PR isn't open | leftover previews removed |

`deploy.yml` has **no path filter** — *every* push to `main` redeploys
production (idempotent; docs-only merges re-upload the same bundle).

Each CI run, before deploying:
`bun install --frozen-lockfile` → `lint` → `fmt:check` → `typecheck` → `test`
→ build the GTFS stop index (`build:index`) → build the web app (`build:web`) →
`verify:pwa` → deploy → **smoke test**. The smoke test polls `/api/health` for
up to ~72 s and fails unless it reports the exact commit SHA just deployed (a
plain 200 isn't enough — the previous build's health endpoint also answers 200).

### Preview teardown

`preview-cleanup.yml` runs on `pull_request_target`, not `pull_request`:
GitHub runs no `pull_request` workflow for a PR with merge conflicts, its
`closed` event included, so closing a stale, conflicting PR used to leave its
preview up. `pull_request_target` runs in main's context whatever state the PR
is in. It checks out main, never the PR's code, which is what makes handing it
the secrets safe. It only takes effect from main, so a PR can't try out its own
edits to it.

The daily sweep lists the account's `tablo-pr-<N>` workers, keeps the ones
whose PR is still open, and destroys the rest. That catches close runs that
failed or never got a runner. Both modes then check through the Cloudflare API
that each worker is gone, and fail if one survived. `alchemy destroy` only
removes what its state knows about, so a preview with no state needs deleting
by hand. A preview stays up as long as its PR is open, drafts included.

## Required GitHub config (repo `i11v/tablo`)

**Secrets:**
- `CLOUDFLARE_API_TOKEN` — needs **Workers** edit **and Secrets Store** (Read+Edit)
  scope, because state lives in `Cloudflare.state()` (an encryption key in
  Secrets Store). Without the Secrets Store scope the deploy can't read/write
  its state store and fails.
- `CLOUDFLARE_ACCOUNT_ID`
- `GOLEMIO_API_TOKEN` — the Prague transit (Golemio) API key the worker needs at
  runtime.
- `HONEYCOMB_API_KEY` (optional) — a Honeycomb ingest key. With it, the worker
  sends traces and logs to Honeycomb (EU region) as service `tablo-worker`;
  without it, it exports nothing. Use the same Honeycomb environment as the iOS
  app so a request's trace runs from the app into the worker. Bound like
  `GOLEMIO_API_TOKEN`: baked into the worker as a secret at deploy time, so
  setting or rotating it takes a redeploy. Previews get it too, tagged with
  `alchemy.stage = pr-<N>`.

**Variable:**
- `CF_WORKERS_SUBDOMAIN = i11v` — the account's workers.dev subdomain. Only used
  to build the smoke-test and preview-comment URLs; both workflows fail fast if
  it's unset. (It really is `i11v`, not the older `ilnur-khalilov`.)

## The stop index (`build:index`)

`build:index` downloads the public Prague GTFS feed (~48 MB, `data.pid.cz`, **no
token**) and writes a hashed stop index into `apps/web/public/data/`, which
is **gitignored** — it's a build artifact, never committed, regenerated every
deploy. CI caches the feed (`actions/cache`) so a `data.pid.cz` outage can't
block a deploy. Both clients load it through `/data/stops-manifest.json`, which
points at the current hashed file.

## Trip plans (also `build:index`)

The same script builds every trip's plan (stops, times, shape) from the feed into
`apps/web/public/data/trips/v1/<route>.json`, one file per route prefix of the
trip id (~900 files, ~160 MB, ~2.3 GB peak RAM, a few seconds). They ship as
static assets; `GET /api/trips/:tripId` reads them through the `ASSETS` binding
and never calls Golemio: an id the deployed feed lacks is a 404. The feed
changes daily, hence the scheduled deploy above. Why assets and not KV/D1/R2,
and why no Golemio fallback: [docs/adr/0001-trip-plans-from-gtfs.md](adr/0001-trip-plans-from-gtfs.md).

## iOS compatibility

The iOS app talks to production by default, and installed builds don't update
when the backend does (no App Store — a build stays on a phone until it's
reinstalled). The app reads the stop index, `/api/ws`, `/api/trips/:tripId`,
`/api/trips/:tripId/vehicle` and `/api/vehicles`, and mirrors their shapes by
hand in `apps/ios/Tablo/API/Wire.swift` (no codegen). So changes to
`packages/contract` must be backward compatible: adding a field is safe (both
Effect Schema and Swift `Decodable` ignore unknown keys); renaming, removing or
retyping one breaks installed builds. To try a backend change on a phone before
merge, bake the PR preview into a build (`TABLO_API_BASE=https://preview-<N>.tablo.run`,
see [`apps/ios/README.md`](../apps/ios/README.md#pointing-at-another-backend)).

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
- **`apps/ios/TabloTests/ContractFixtures/*.json`** are sample payloads encoded by
  the schemas (`scripts/lib/wire-fixtures.ts`), which `ContractTests.swift`
  decodes, asserting every value. A wire change regenerates them, so it runs
  the iOS workflow — the current app must read what the backend now sends.

`bun run test` fails when either file is out of date, or when the samples
don't show every field in every form (a nullable field both null and set).

## Custom domains (`tablo.run`)

Attached via the worker's `domain` prop in `apps/worker/src/index.ts`. The
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
`gh run rerun <id> --failed`, or on the next daily sweep.

## tablo-specific footguns

Two that bite this project hardest:

1. **Stage name must come from `process.env.TABLO_STAGE`, read at module load —
   never from the `Alchemy.Stage` service.** The worker derives its name (and its
   custom hostname, via `workerDomain`) from `WORKER_STAGE` in
   `apps/worker/src/index.ts`.
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
