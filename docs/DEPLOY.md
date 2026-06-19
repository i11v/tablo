# Deploying tablo

CI-owned [Alchemy](https://github.com/alchemy-run/alchemy) deploys to Cloudflare.
Everything specific to deploying tablo is below.

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
`bun install --frozen-lockfile` → `typecheck` → `test` → build the GTFS stop
index (`build:index`) → build the web app (`build:web`) → `verify:pwa` →
deploy → **smoke test**. The smoke test polls `/api/health` for up to ~72 s and
fails unless it reports the exact commit SHA just deployed (a plain 200 isn't
enough — the previous build's health endpoint also answers 200).

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
block a deploy.

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

### The `@distilled.cloud/core` patch (do not delete lightly)

Deleting a Workers custom domain (preview teardown on PR close, or production
switching to a new domain) hits a beta CF-client bug: Cloudflare answers the
`DELETE …/workers/domains/{id}` with an empty `200`, the client fails to decode
it, and the whole `deploy`/`destroy` aborts with the misleading
`CloudflareHttpError: null` — orphaning the worker + its state. Fixed by
`patches/@distilled.cloud%2Fcore@0.23.1.patch` (a `bun patch`; treats an empty
2xx body as no-content). `bun install --frozen-lockfile` re-applies it on every
CI runner. **Drop the patch only once upstream
[alchemy-run/distilled#344](https://github.com/alchemy-run/distilled/pull/344)
ships in a released `@distilled.cloud/core`.** No-patch escape hatch: the DELETE
*succeeds* server-side, so a failed teardown completes on a plain
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
