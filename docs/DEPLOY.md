# Deploying tablo

CI-owned [Alchemy](https://github.com/alchemy-run/alchemy) deploys to Cloudflare.
Everything specific to deploying tablo is below.

## Live URLs

| What | URL |
|------|-----|
| Production (custom domain) | https://tablo.i11v.com |
| Production (workers.dev) | https://tablo.i11v.workers.dev |
| PR preview | https://tablo-pr-`<N>`.i11v.workers.dev (posted as a sticky PR comment) |

Both production URLs serve the same worker; the custom domain is in addition to
the workers.dev one, not a replacement.

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

## Custom domain (`tablo.i11v.com`)

Attached via the worker's `domain` prop in `packages/worker/src/index.ts`, gated
on `WORKER_STAGE === "production"`:

```ts
...(WORKER_STAGE === "production" ? { domain: "tablo.i11v.com" } : {}),
```

- The `i11v.com` zone already exists in the account, so Cloudflare
  auto-provisions the proxied DNS record + TLS cert on deploy — no dashboard or
  DNS steps.
- Previews never get a custom domain (the gate), so they can't fight over the
  shared hostname.
- **Don't hand-add domains in the Cloudflare dashboard** — Alchemy reconciles the
  worker's domains against the `domain` prop and would remove anything extra.

## tablo-specific footguns

Two that bite this project hardest:

1. **Stage name must come from `process.env.TABLO_STAGE`, read at module load —
   never from the `Alchemy.Stage` service.** The worker derives its name (and the
   custom-domain gate) from `WORKER_STAGE` in `packages/worker/src/index.ts`.
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
