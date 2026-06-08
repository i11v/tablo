# tablo deploy automation — design

**Date:** 2026-06-08
**Status:** approved (design); pending spec review
**Reference:** `alchemy-cloudflare-deploy-guide.md` (repo root)

## Goal

CI owns every deploy. No more laptop production deploys.

- **Push to `main`** -> deploy production.
- **Open / update a PR** -> isolated preview deploy with a sticky URL comment.
- **Close a PR** -> automatic teardown of that preview.

Adapted from the Alchemy + GitHub Actions guide, with the three ways tablo
differs from the guide's example baked in:

1. tablo is a **custom Effect `Cloudflare.Worker`** (DOs + static assets + API),
   not a `StaticSite`. Alchemy does **not** run a build for it — it uploads a
   prebuilt `packages/web/dist`. CI must build before deploying.
2. State is currently **`Alchemy.localState()`** (gitignored `.alchemy/`). CI
   can't see local state, so it must move to **`Cloudflare.state()`** (shared).
3. **No custom domain** is attached (workers.dev only). The guide's worst
   pitfall (domain-reconcile crash, Pitfall 3) does not apply here.

## Architecture overview

```
push main ---> deploy.yml ---------------> alchemy deploy --stage production ---> worker "tablo"
PR opened ---> pr-preview.yml (preview) --> alchemy deploy --stage pr-<N>     ---> worker "tablo-pr-<N>"
PR closed ---> pr-preview.yml (cleanup) --> alchemy destroy --stage pr-<N>    ---> (removed)

shared state: Cloudflare.state()  <-- laptop (dev/bootstrap only) + CI both read/write
worker secret: GOLEMIO_API_TOKEN captured from env at deploy-plan ---> bound as secret_text
```

## Components

### 1. Shared state — `alchemy.run.ts`

Change one line:

```ts
// before
{ providers: Cloudflare.providers(), state: Alchemy.localState() }
// after
{ providers: Cloudflare.providers(), state: Cloudflare.state() }
```

`Cloudflare.state()` keeps Alchemy's record of what it deployed *in Cloudflare*
(an `alchemy-state-store` worker + SQLite Durable Object + an encryption key in
Secrets Store), shared across every machine that deploys. One-time bootstrap
(see "Required manual setup") provisions it. In CI it authenticates with
`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`; the token **must** include the
**Secrets Store** scope (Pitfall 1) or state reads/writes fail.

### 2. Stage-aware worker name — `packages/worker/src/index.ts`

Today the `Cloudflare.Worker` props are a static object with **no `name`**, so
Alchemy derives a physical name `${stack}-${id}-${stage}-<random>` — stage-safe
but a non-deterministic URL. We set an explicit, stage-derived `name` instead.

New pure helper `packages/worker/src/workerName.ts`:

```ts
export const workerName = (stage: string): string =>
  stage === "production" ? "tablo" : `tablo-${stage}`
```

- `production` -> `tablo` -> stable `tablo.<subdomain>.workers.dev`
- `pr-42` -> `tablo-pr-42` -> URL is constructible for the PR comment
- `dev_<user>` -> `tablo-dev_<user>` (local only)

Worker definition changes its **props argument from a static object to an
Effect that reads the stage** (Alchemy supports props-as-Effect; the props
Effect runs lazily when the class is yielded inside the Stack, not at module
load, so the class can stay top-level):

```ts
import * as Alchemy from "alchemy"
import { workerName } from "./workerName.ts"

export default class Server extends Cloudflare.Worker<Server>()(
  "Server",
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage
    return {
      name: workerName(stage),
      main: import.meta.filename,
      compatibility: { date: "2026-06-01", flags: ["nodejs_compat"] },
      assets: { /* unchanged */ },
      url: true,
      ...(devOptions ? { dev: devOptions } : {}),
    }
  }),
  Effect.gen(function* () { /* impl unchanged */ }),
) {}
```

This is the guide's `siteName` pattern (Pitfall 2) applied to the Worker's
`name` prop. `name` is used verbatim by Alchemy (no random suffix), so previews
get deterministic, isolated names that can never collide with production.

### 3. Production workflow — `.github/workflows/deploy.yml`

```yaml
name: Deploy (production)
on:
  push:
    branches: [main]
concurrency:
  group: deploy-production
  cancel-in-progress: false        # Pitfall 6 — queue, never kill mid-write
permissions:
  contents: read
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: "1.3.14" }
      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      - run: bun run test
      - run: bun run build:index     # public GTFS download, no token
      - run: bun run build:web
      - name: Deploy to production
        run: bunx alchemy deploy --stage production --yes
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          GOLEMIO_API_TOKEN: ${{ secrets.GOLEMIO_API_TOKEN }}
```

`build:index` must run before `build:web` — it writes the stop index into
`packages/web/public/data/` (gitignored), which Vite then copies into `dist/`.

### 4. PR-preview workflow — `.github/workflows/pr-preview.yml`

```yaml
name: PR preview
on:
  pull_request:
    types: [opened, synchronize, reopened, closed]
concurrency:
  group: preview-${{ github.event.pull_request.number }}
  cancel-in-progress: false
permissions:
  contents: read
  pull-requests: write             # to comment the preview URL
jobs:
  preview:
    if: github.event.action != 'closed'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: "1.3.14" }
      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      - run: bun run test
      - run: bun run build:index
      - run: bun run build:web
      - name: Require CF_WORKERS_SUBDOMAIN
        env: { CF_WORKERS_SUBDOMAIN: "${{ vars.CF_WORKERS_SUBDOMAIN }}" }
        run: |
          if [ -z "$CF_WORKERS_SUBDOMAIN" ]; then
            echo "::error::CF_WORKERS_SUBDOMAIN repo variable is not set."
            exit 1
          fi
      - name: Deploy preview
        run: bunx alchemy deploy --stage "pr-${{ github.event.pull_request.number }}" --yes
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          GOLEMIO_API_TOKEN: ${{ secrets.GOLEMIO_API_TOKEN }}
      - name: Comment preview URL
        uses: actions/github-script@v7
        env:
          PREVIEW_URL: https://tablo-pr-${{ github.event.pull_request.number }}.${{ vars.CF_WORKERS_SUBDOMAIN }}.workers.dev
        with:
          script: |
            const marker = '<!-- tablo-preview -->';
            const body = `${marker}\n🚀 **Preview deployed:** ${process.env.PREVIEW_URL}`;
            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner, repo: context.repo.repo,
              issue_number: context.issue.number,
            });
            const existing = comments.find((c) => c.body && c.body.includes(marker));
            const api = existing ? 'updateComment' : 'createComment';
            await github.rest.issues[api]({
              owner: context.repo.owner, repo: context.repo.repo,
              ...(existing ? { comment_id: existing.id } : { issue_number: context.issue.number }),
              body,
            });
  cleanup:
    if: github.event.action == 'closed'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: "1.3.14" }
      - run: bun install --frozen-lockfile
      - name: Destroy preview
        run: bunx alchemy destroy --stage "pr-${{ github.event.pull_request.number }}" --yes
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          GOLEMIO_API_TOKEN: ${{ secrets.GOLEMIO_API_TOKEN }}
```

The preview URL is constructed from the deterministic worker name
(`tablo-pr-<N>`) plus `CF_WORKERS_SUBDOMAIN`. Previews only work for same-repo
branches — fork PRs don't receive secrets (Pitfall 7); acceptable for a solo repo.

### 5. `package.json` convenience script

Add `"build": "bun run build:index && bun run build:web"` (keeps things tidy and
gives one local command). CI still lists the two steps explicitly for clear
per-step logs; the combined script is for local use.

## Required manual setup (one-time)

Done by the user; CI cannot create CF tokens or set repo secrets.

1. **Cloudflare API token** (account-scoped):
   Workers Scripts: **Edit** · Secrets Store: **Edit + Read** · Account
   Settings: **Read**.
2. **Bootstrap shared state** locally, once:
   `bunx alchemy bootstrap cloudflare`
3. **Repo secrets** (Settings -> Secrets and variables -> Actions):
   `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `GOLEMIO_API_TOKEN`.
4. **Repo variable**: `CF_WORKERS_SUBDOMAIN` — the `<sub>` in
   `<name>.<sub>.workers.dev`.

## Migration cutover (one-time, no downtime)

1. Land the code changes (state switch + stage-aware name + workflows) on `main`.
2. CI's first production run creates the **new** `tablo` worker at its stable
   URL.
3. **Then** tear down the old random-named workers held in local state:
   `bunx alchemy destroy --stage prod --yes` and
   `bunx alchemy destroy --stage dev_ilnur --yes` (these use the old local
   state; run after the new prod worker is live).
4. Going forward: **never** run `alchemy deploy --stage production` locally
   (Pitfall 4 — a laptop/worktree absolute assets path would poison the shared
   state and break CI).

DOs (`ClientSession`, `GolemioGateway`) hold only ephemeral cache / rate-limit /
session state, so the new worker starting with fresh DO storage loses nothing.

## Testing

- **Unit:** `workerName(stage)` — pure function: `production` -> `tablo`,
  `pr-42` -> `tablo-pr-42`, `dev_x` -> `tablo-dev_x`.
- **CI gates:** `bun run typecheck` + `bun run test` (existing vitest unit
  suite) block every deploy. `test:integration` is **excluded** from CI (it
  calls the live Golemio API).
- **Manual verification:** confirm the first production deploy serves at
  `tablo.<subdomain>.workers.dev`; open a throwaway PR and confirm a preview
  deploys, comments its URL, and is destroyed on close.

## Pitfall coverage (from the guide)

| # | Pitfall | Handled by |
|---|---------|-----------|
| 1 | Token missing Secrets Store scope | token scopes (manual setup) |
| 2 | Worker names not namespaced per stage | stage-aware `name` (§2) |
| 3 | Custom-domain reconcile crash | N/A — no custom domain |
| 4 | Laptop/worktree poisons shared state | migration rule: prod only in CI |
| 5 | Stale stage shares prod's worker | fresh CF state, old stages destroyed |
| 6 | `cancel-in-progress: true` corrupts deploy | `cancel-in-progress: false` (§3/§4) |
| 7 | Fork PRs lack secrets | same-repo only (§4) |

## Out of scope

- Custom domain (workers.dev only, by current design).
- Running `test:integration` in CI (network-dependent).
- `pull_request_target` / fork-PR previews (security; Pitfall 7).
