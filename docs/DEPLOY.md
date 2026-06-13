# Deploying tablo to Cloudflare with Alchemy + GitHub Actions

The single source of truth for how tablo ships. CI owns every deploy:
**push to `main` → production**, **open/update a PR → an isolated preview**,
**close a PR → automatic teardown**. This doc is the as-built runbook plus the
**pitfalls we actually hit and how we recovered** — read the pitfalls before you
touch the pipeline.

> Distilled from the deploy-automation build + go-live sessions (2026-06-08/09).
> Generic, framework-level version (static-site example): see
> [`alchemy-cloudflare-deploy-guide.md`](../alchemy-cloudflare-deploy-guide.md)
> at the repo root. This doc is the **tablo-specific** companion — it adds the
> Worker/Effect/Durable-Object pitfalls that the static-site guide never hits.
>
> Versions this was written against: Alchemy `2.0.0-beta.52` (Effect-based v2),
> Bun `1.3.14`, Effect `4.0.0-beta.78`, `@distilled.cloud/cloudflare` (Alchemy's
> generated CF API client). All beta — behaviour and bugs below may change.

---

## 0. Current live state (as of last session)

- **Production is live via CI** at `https://tablo.i11v.workers.dev`
  (stage `production` → worker **`tablo`**), state in `Cloudflare.state()`.
- **Custom domain** `https://tablo.i11v.com` is also live, attached via the
  worker's `domain` prop (production stage only — see §3.3). The workers.dev URL
  stays live alongside it.
- Repo `i11v/tablo`; account workers.dev subdomain is **`i11v`**.
- Two PRs (state switch + stage-aware name + workflows, then the runtime fixes)
  were merged; the PR-preview pipeline was tested green on PR #1.
- **Legacy pre-CI workers** from the old local-state era
  (`tablo-server-prod-kiniomotcmemc4po`, `tablo-server-dev-ilnur-…`) may still
  exist — they live only in gitignored **local** `.alchemy/` state, invisible to
  CI. Remove them with the procedure in **Pitfall T4** (NOT with
  `destroy --stage production`).

---

## 1. Mental model

Three concepts; every pitfall traces back to one of them.

- **Stack** — the whole deploy, declared in `alchemy.run.ts` (`Alchemy.Stack("tablo", …)`).
- **Stage** — a named, isolated instance of the stack (`--stage production`,
  `--stage pr-42`, default `dev_${USER}`). Each stage has its **own state**, but
  **resource names are NOT auto-namespaced by stage** — see Pitfall T-naming / G2.
- **State store** — Alchemy's record of what it deployed, so it can diff/update.
  tablo uses **`Cloudflare.state()`**: state lives *in Cloudflare* (an
  `alchemy-state-store` worker + SQLite Durable Object + an encryption key in
  **Secrets Store**), **shared across every machine** that deploys — your laptop
  and CI write to the same store. That sharing is the source of the nastiest
  pitfalls (G4, T5).

On every deploy Alchemy evaluates `alchemy.run.ts` → diffs desired vs. stored
state → applies create/update/delete.

---

## 2. How tablo differs from the generic static-site guide

tablo is **not** a `Cloudflare.StaticSite`. It's a custom Effect
`Cloudflare.Worker` bundling **Durable Objects + static assets + an Effect
HttpApi**. Three consequences shape the whole pipeline:

1. **Alchemy does NOT build it.** For a `StaticSite`, Alchemy runs your `command`
   and hashes `outdir`. For a custom Worker it just uploads a *prebuilt*
   `packages/web/dist`. **CI must build before deploying** (`build:index` then
   `build:web` — see Pitfall T7).
2. **State is shared (`Cloudflare.state()`), not local.** It started as
   `Alchemy.localState()` (gitignored `.alchemy/`); CI can't see local state, so
   go-live switched it to `Cloudflare.state()`. The switch stranded the old
   local-state workers (Pitfall T4).
3. **Custom domain in production** — `tablo.i11v.com`, attached via the worker's
   `domain` prop, gated on `WORKER_STAGE === "production"` so previews never grab
   the shared hostname (§3.3). The `i11v.com` zone already exists in the account,
   so Cloudflare auto-provisions the proxied DNS record + cert on deploy. Because
   only one hostname is ever set (and only for prod), the static-site guide's G3
   reconcile crash hasn't bitten — but it's now *in scope*, not N/A (see G3).

In exchange, tablo hits **runtime** pitfalls a static site never can: an Effect
service leaking into the worker runtime (T1), an Alchemy-CLI peer dep (T2), and
a worker that boots-and-dies behind a "successful" deploy (T3).

---

## 3. The as-built pipeline

### 3.1 `alchemy.run.ts` — shared state

```ts
import * as Alchemy from "alchemy"
import * as Cloudflare from "alchemy/Cloudflare"
import * as Effect from "effect/Effect"
import Server from "./packages/worker/src/index.ts"

export default Alchemy.Stack(
  "tablo",
  { providers: Cloudflare.providers(), state: Cloudflare.state() }, // shared — CI + laptop
  Effect.gen(function* () {
    const server = yield* Server
    return { url: server.url }
  }),
)
```

### 3.2 Stage-aware worker name — `packages/worker/src/workerName.ts`

Stages don't namespace resource names, so derive the Worker name from the stage
yourself. Production keeps the bare name (stable URL); everything else is
suffixed so a preview can never overwrite production.

```ts
export const workerName = (stage: string): string =>
  stage === "production" ? "tablo" : `tablo-${stage}`
// production → tablo · pr-42 → tablo-pr-42 · dev_ilnur → tablo-dev_ilnur
```

### 3.3 Reading the stage **without** `Alchemy.Stage` — `packages/worker/src/index.ts`

⚠️ **This is the single most important tablo-specific lesson** — see Pitfall T1.
The stage is read from **`process.env.TABLO_STAGE` at module load**, and the
Worker props are a **static object**, not an Effect that yields `Alchemy.Stage`:

```ts
// Deploy-time stage, read at module load. CI sets TABLO_STAGE to match the
// `alchemy deploy --stage <…>` value. We deliberately do NOT read the
// `Alchemy.Stage` Context service inside the Worker definition: it exists only
// at deploy/plan time, and reading it there leaks a `Stage` requirement into
// the worker's RUNTIME context → "Service not found: Stage" → 1101 on every
// request. Locally we fall back to dev_<user> so a stray local deploy can never
// grab the bare `tablo` (production) name.
const WORKER_STAGE =
  (typeof process !== "undefined" && process.env?.TABLO_STAGE) ||
  (typeof process !== "undefined" && process.env?.USER ? `dev_${process.env.USER}` : "local")

export default class Server extends Cloudflare.Worker<Server>()(
  "Server",
  {
    name: workerName(WORKER_STAGE),          // verbatim — no random suffix
    main: import.meta.filename,
    compatibility: { date: "2026-06-01", flags: ["nodejs_compat"] },
    assets: {
      directory: "./packages/web/dist",
      notFoundHandling: "single-page-application",
      runWorkerFirst: ["/api/*"],            // /api/* → worker; everything else → assets router
    },
    url: true,
    // Production also answers on the custom hostname. Gated on the production
    // stage so a preview (tablo-pr-N) never tries to grab the shared domain;
    // the zone is inferred from the hostname and must already exist.
    ...(WORKER_STAGE === "production" ? { domain: "tablo.i11v.com" } : {}),
    ...(devOptions ? { dev: devOptions } : {}),
  },
  Effect.gen(function* () { /* runtime impl — DOs + HttpApi */ }),
) {}
```

### 3.4 `package.json` scripts

```jsonc
{
  "scripts": {
    "build": "bun run build:index && bun run build:web", // local convenience
    "build:index": "…",   // downloads public Prague GTFS, writes stop index into
                          // packages/web/public/data/ (gitignored). NO token needed.
    "build:web": "…",     // vite build → packages/web/dist (copies public/data/ in)
    "deploy": "alchemy deploy",
    "destroy": "alchemy destroy"
  },
  "devDependencies": {
    "@effect/platform-bun": "4.0.0-beta.78"  // REQUIRED — see Pitfall T2
  }
}
```

`build:index` **must** run before `build:web` (it writes the data Vite copies
into `dist/`).

### 3.5 Production workflow — `.github/workflows/deploy.yml`

```yaml
name: Deploy (production)
on:
  push: { branches: [main] }
concurrency:                    # serialize prod deploys; never kill mid-write
  group: deploy-production
  cancel-in-progress: false     # Pitfall G6
permissions: { contents: read }
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
      - run: bun run build:index   # before build:web (Pitfall T7)
      - run: bun run build:web
      - name: Deploy to production
        run: bunx alchemy deploy --stage production --yes
        env:
          TABLO_STAGE: production           # ← consumed by the worker (Pitfall T1)
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          GOLEMIO_API_TOKEN: ${{ secrets.GOLEMIO_API_TOKEN }}   # Pitfall T8
      - name: Smoke test (/api/health)      # ← Pitfall T3: deploy success ≠ working worker
        env: { URL: "https://tablo.${{ vars.CF_WORKERS_SUBDOMAIN }}.workers.dev" }
        run: |
          for i in $(seq 1 12); do
            code=$(curl -sS -o /dev/null -w "%{http_code}" "$URL/api/health" || echo 000)
            echo "attempt $i: $URL/api/health -> $code"
            [ "$code" = "200" ] && exit 0
            sleep 6
          done
          echo "::error::production health check failed for $URL/api/health"; exit 1
```

### 3.6 PR-preview workflow — `.github/workflows/pr-preview.yml`

Same build/deploy steps with `--stage pr-<N>` and `TABLO_STAGE: pr-<N>`, plus:
a `Require CF_WORKERS_SUBDOMAIN` guard, the same `/api/health` smoke test against
`tablo-pr-<N>.<subdomain>.workers.dev`, and a **sticky** preview-URL comment
(`<!-- tablo-preview -->` marker, update-or-create). A second `cleanup` job runs
on `closed` and does `bunx alchemy destroy --stage pr-<N> --yes`. Both jobs use
`cancel-in-progress: false`.

---

## 4. First-time setup (one-time, user-run)

CI can't mint tokens or set secrets — these are done once by hand.

1. **Cloudflare API token** (account-scoped):
   - **Workers Scripts: Edit**
   - **Secrets Store: Edit + Read** ← easy to miss; `Cloudflare.state()` needs it (G1)
   - **Account Settings: Read**

   Mint one with `bunx alchemy cloudflare create-token`, or fix scopes in the CF
   dashboard.
2. **Bootstrap the shared state store** (provisions live CF infra — run locally,
   once):
   ```sh
   bunx alchemy cloudflare bootstrap
   ```
   - It's `alchemy cloudflare bootstrap` — **not** a top-level `alchemy bootstrap`.
   - Creates the `alchemy-state-store` worker + SQLite Durable Object + an
     encryption key in **Secrets Store**.
   - Uses your local `default` Cloudflare OAuth profile (`bunx alchemy profile
     show` to confirm; `profile list` is not a valid subcommand).
   - **Idempotent**: an existing store is *adopted* and only its credentials
     refreshed. Use `--force` only to force a full redeploy.
   - *(The Claude Code safety classifier refuses to run this for you — it
     provisions shared cloud infra. It's yours to run.)*
3. **Repo secrets** (Settings → Secrets and variables → Actions):
   `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `GOLEMIO_API_TOKEN`.
   ```sh
   # GOLEMIO lives in local .env, not a repo secret by default:
   printf '%s' "$(grep '^GOLEMIO_API_TOKEN=' .env | cut -d= -f2-)" \
     | gh secret set GOLEMIO_API_TOKEN -R i11v/tablo
   ```
4. **Repo variable** `CF_WORKERS_SUBDOMAIN` — the `<sub>` in
   `<name>.<sub>.workers.dev`. For this account it's **`i11v`** (see Pitfall T6).

---

## 5. Pitfalls & recovery

Every one of these actually happened. The **T-series are tablo-specific** (Worker
/ Effect / DO / ops) and are the reason this doc exists alongside the generic
guide; the **G-series** are the framework-level ones from
[`alchemy-cloudflare-deploy-guide.md`](../alchemy-cloudflare-deploy-guide.md),
summarised here with tablo's handling.

### T1 — `Alchemy.Stage` leaks into the worker runtime → error 1101 on every `/api/*`  ⭐

**The big one.** Typecheck + 49/49 unit tests were green; it only surfaced on the
first real CI deploy, at runtime.

**Symptom:** the SPA at `/` served `200`, but every `/api/*` request returned
`HTTP 500` with Cloudflare **`error code: 1101`** ("Worker threw a JS
exception"), consistently (not a cold start). `bunx alchemy logs --stage pr-1`
revealed the real exception:
```
[Server] GET https://tablo-pr-1.i11v.workers.dev/api/health
[Server] Service not found: Stage (defined at index.js:…)
```

**Root cause:** the Worker's props were written as `Effect.gen(function* () {
const stage = yield* Alchemy.Stage; return { name: workerName(stage), … } })`.
`Alchemy.Stage` is a `Context.Service` **provided only at deploy/plan time**
(`Layer.succeed(Stage, options.stage)` in Alchemy's `Stack.ts`). Reading it
*inside the Worker definition* leaked a `Stage` requirement into the worker's
**runtime** context, where nothing provides `Stage` → worker init throws → 1101
on every path that invokes the worker. `/` worked because the Cloudflare assets
router serves static files *before* the worker runs, masking the crash. (The old
prod worker used **static** props with no `Stage` read, so it was fine — which is
why the GOLEMIO secret was wrongly suspected first; see T8.)

**Fix:** read the stage from **`process.env.TABLO_STAGE` at module load** and make
the props a **static object** (§3.3). CI passes `TABLO_STAGE` matching `--stage`;
local falls back to `dev_${USER}`. *(commit `1c4928b`)*

**Verify:** `curl …/api/health` → `{"ok":true,"version":"0.1.0"}` (200);
`/api/ws` with no session → `400 "missing session id"` (proves `/api/*` routes
into the worker and the DO namespace resolves); `alchemy logs` shows no `Service
not found`.

**General rule:** never read a deploy/plan-time Effect service (`Alchemy.Stage`,
etc.) inside a `Cloudflare.Worker` definition. Anything the *runtime* needs must
come from `process.env` (at module load) or a worker binding.

### T2 — `@effect/platform-bun` is an Alchemy optional-peer dep that a frozen install skips

**Symptom:** the deploy step (`bunx alchemy deploy …`) died — everything before
it (install/typecheck/test/build) passed:
```
error: Cannot find module '@effect/platform-bun/BunRuntime' from
'…/node_modules/alchemy/src/Util/PlatformServices.ts'
```

**Root cause:** Alchemy's CLI **dynamically `import()`s** `@effect/platform-bun`
at runtime (`PlatformServices.ts`), but declares it only as an **optional peer**
(`peerDependenciesMeta: { "@effect/platform-bun": { optional: true } }`). Because
it was never an explicit dependency of tablo, `bun install --frozen-lockfile`
**skips it** on a clean CI runner (it only appears in `bun.lock` as a transitive
`optionalPeers` entry). It happened to be present on the laptop, so this never
showed up locally.

**Fix:** add it as an **explicit, exact devDependency** pinned to the same Effect
version the repo uses:
```sh
bun add --dev --exact @effect/platform-bun@4.0.0-beta.78   # match effect@4.0.0-beta.78
```
*(commit `9ee92e8`)*

**Verify:** `bun --eval 'await import("@effect/platform-bun/BunRuntime")'` prints
no error; the re-run deploy step uploads the worker.

### T3 — A "successful" `alchemy deploy` can still ship a worker that 1101s → add a smoke test

**Symptom:** `alchemy deploy` exited `0` and CI went green, yet the worker
threw on every API request (that's how T1 slipped through to a "successful"
deploy).

**Fix:** a post-deploy **`/api/health` smoke test** in both workflows (§3.5) —
poll up to 12× / 6s apart, fail the job unless it returns `200`. Closes the gap
that let a non-functional worker pass CI. Requires a trivial health endpoint
(`HttpApiEndpoint.get("health", "/api/health")` → `{ ok: true, version }`).

**Rule:** deploy-tool success ≠ worker health. Always assert a real HTTP request
after deploy.

### T4 — `alchemy destroy` has no `--local`; `destroy --stage prod` from `main` is a silent NO-OP (and `prod` ≠ `production`)

**Symptom/risk:** a handoff note said to clean up old workers with
`bunx alchemy destroy --stage prod --yes`. Run from `main`, it deletes **nothing**
— while the operator (reasonably) fears it might nuke live prod.

**Root cause (two compounding facts):**
1. **`destroy` has no `--local` flag** (its flags are only `--dry-run`,
   `--env-file`, `--stage`, `--yes`, `--profile`). It always reads whatever
   `state:` the *current checkout's* `alchemy.run.ts` declares. On `main` that's
   `Cloudflare.state()` (shared) — which has no `prod` stage.
2. The live prod is stage **`production`** → worker **`tablo`** (shared state).
   The legacy manual deploys were stage **`prod`** → worker
   `tablo-server-prod-kiniomotcmemc4po`, tracked only in **local** `.alchemy/`.
   **`prod` ≠ `production`** (different stage namespace *and* different recorded
   worker name), so `--stage prod` can never select `tablo`.

**Safe cleanup of the legacy local-state workers — pick one:**
- **Dashboard / wrangler (simplest):** delete the worker directly
  (`wrangler delete tablo-server-prod-kiniomotcmemc4po`). Confirmed safe in
  practice — the old worker went `404` while `tablo.i11v.workers.dev/api/health`
  stayed `200`.
- **Temporary local state:** in `alchemy.run.ts` set `state:` back to
  `Alchemy.localState()` (**do not commit**), run
  `bunx alchemy destroy --stage prod --yes` and `--stage dev_ilnur --yes`, then
  revert.
- Prefer `--dry-run` over `--yes` to preview first.

**Hard rule:** **NEVER run `destroy --stage production`** — that deletes the live
`tablo`. The dangerous word is the full `production`, not `prod`.
*(Also: `bunx alchemy state stages tablo` was unreliable here — trust the
workflow `--stage` values and the on-disk `.alchemy/state/.../Server.json` over
the CLI listing.)*

### T5 — Deploying prod from a git worktree creates a DUPLICATE worker

**Symptom:** during the UI redesign, a prod deploy from a git worktree created a
*second* prod worker (new random `workers.dev` suffix) instead of updating the
existing one.

**Root cause:** a worktree has its own worktree-local `.alchemy/` state. With
local state, Alchemy had no record of the existing prod worker → it created a
fresh one instead of diffing/updating. (With **shared** state the failure mode is
worse — see G4: the worktree's absolute assets path gets written into the shared
store and breaks the next CI run.)

**Recovery used:** destroy the dup, copy `main`'s `.alchemy/state/tablo/prod`
into the worktree, redeploy (registers as an UPDATE).

**Rule:** **deploy prod only from CI** (which always runs from a stable runner
cwd). Never `alchemy deploy --stage production` from a laptop or worktree. This
is the core reason CI owns every deploy.

*(Related worktree friction: a fresh worktree doesn't inherit `node_modules` —
run `bun install` (+ `bun run prepare`/`tsc`) or you get ~57 spurious "react
module not found" errors. `packages/web/public/data/` is gitignored build
output.)*

### T6 — workers.dev subdomain confusion (`i11v` vs `ilnur-khalilov`) — confirm, don't infer

**Symptom:** old local state recorded URLs at `…ilnur-khalilov.workers.dev`, but
the repo variable was `CF_WORKERS_SUBDOMAIN=i11v`. It *looked* like a mistake (a
GitHub-handle slip), but the inference was backwards.

**Resolution:** the account's workers.dev subdomain had recently been changed to
**`i11v`**, so the variable was correct; `ilnur-khalilov` was stale and no longer
resolves (`Could not resolve host`). The subdomain affects **only** the
PR-preview comment link (prod uses `url: true` regardless) — a wrong value just
404s preview links.

**Rule:** confirm the subdomain with the account owner / CF dashboard (Workers &
Pages → account subdomain); don't infer it from stale state.

### T7 — Alchemy doesn't build a custom Worker; CI must build first, in order

**Symptom/risk:** a `StaticSite` is built by Alchemy; a custom `Cloudflare.Worker`
is not — Alchemy just uploads the prebuilt `packages/web/dist`. Deploy without
building → ship stale/missing assets.

**Rule:** CI runs `bun run build:index` **then** `bun run build:web` before
`alchemy deploy`. `build:index` downloads the public Prague GTFS and writes the
stop index into `packages/web/public/data/` (gitignored, no token); `build:web`
(Vite) copies that into `dist/`. Order matters.

### T8 — `GOLEMIO_API_TOKEN` must be a repo secret; a missing one dies on boot with the same 1101 signature

**Symptom/risk:** the worker reads `Config.redacted("GOLEMIO_API_TOKEN").pipe(
Effect.orDie)` at init (in `do/gateway.ts`). If it's unreadable the worker
**dies on boot → 1101**, indistinguishable at the HTTP layer from T1. The token
lived only in local `.env`, not as a repo secret.

**Fix:** set it as a repo secret and export it in every deploy/destroy step
(§3.5, §4). A green `/api/health` transitively proves the binding works (worker
init read it). **Debugging tip:** when you see 1101, use `alchemy logs` to get
the real exception before guessing between T1 and T8.

---

#### G-series — framework-level pitfalls (see the generic guide for full detail)

| # | Pitfall | tablo handling |
|---|---------|----------------|
| **G1** | API token missing **Secrets Store** scope → can't read/write `Cloudflare.state()` | token includes Secrets Store: Edit + Read (§4). *Was present here — not the 1101 cause.* |
| **G2** | Worker names not namespaced per stage → preview clobbers prod | stage-aware `workerName()` (§3.2) |
| **G3** | Custom-domain reconcile deletes "extra" domains and the beta client crashes on the `null` delete response | **In scope** since `tablo.i11v.com` (§3.3). Mitigated: exactly one hostname, set only for `production` (previews get none), so the reconcile never has an "extra" domain to delete. Don't hand-add domains in the CF dashboard — Alchemy would reconcile them away. |
| **G4** | Deploying from a laptop/worktree writes an **absolute assets path** into shared state → next CI run `NotFound: …/dist` | **prod only in CI** (T5). Recover a poisoned run with `gh run rerun <id> --failed` (self-heals the stored path) |
| **G5** | A stale stage sharing the same physical worker → a default-stage deploy renames/deletes live prod | fresh `Cloudflare.state()`; old stages destroyed post-cutover (T4) |
| **G6** | `cancel-in-progress: true` kills a deploy mid-state-write → corrupt state | `cancel-in-progress: false` on both workflows (§3.5) |
| **G7** | Fork PRs don't receive `secrets.*` → preview fails | same-repo only (solo repo); no `pull_request_target` |

---

## 6. Migration cutover (one-time, no downtime) — for reference

1. Land the code changes on `main`: `Alchemy.localState()` → `Cloudflare.state()`,
   stage-aware `workerName`, `TABLO_STAGE` env wiring, the two workflows.
2. Ensure §4 setup is done **first** (token scope, bootstrap, secrets, variable)
   — or the first run fails / preview links break.
3. CI's first production run creates the **new** `tablo` worker at its stable URL.
4. **Then** tear down the old random-named workers held in **local** state
   (Pitfall T4 — dashboard/wrangler, or a temporary localState; never
   `--stage production`).
5. Going forward: **never** `alchemy deploy --stage production` locally (G4/T5).

DOs (`ClientSession`, `GolemioGateway`) hold only ephemeral cache / rate-limit /
session state, so the new worker starting with fresh DO storage loses nothing.

---

## 7. Recovery toolbox (read-only first)

```sh
# Real exception behind a 1101 (T1/T8) — do this BEFORE guessing
bunx alchemy logs --stage <stage>

# What stages / resources exist? (treat listings as advisory — see T4)
bunx alchemy state stages tablo
bunx alchemy state resources tablo <stage>

# Inspect a resource's stored output (worker name, assets dir, url)
bunx alchemy state get tablo <stage> Server

# Re-run a failed CI deploy — self-heals the G4 absolute-assets-path poisoning
gh run rerun <run-id> --failed
gh run view <run-id> --log-failed

# Adopt an existing live worker into a stage's state
bunx alchemy deploy --stage <stage> --adopt

# Drop a stale stage's STATE (not the live worker)
bunx alchemy state clear tablo <stage> --yes

# Tear down a stage's live resources (NEVER --stage production)
bunx alchemy destroy --stage <stage> --dry-run   # preview first
bunx alchemy destroy --stage <stage> --yes

# Bootstrap / refresh the shared state store (idempotent; adopts existing)
bunx alchemy cloudflare bootstrap
```

Verify a live deploy:
```sh
curl -s "https://tablo.i11v.workers.dev/api/health"     # {"ok":true,"version":"0.1.0"}
curl -s "https://tablo.i11v.workers.dev/api/ws"         # "missing session id" (400) → /api/* hits worker
```

---

## 8. Pre-flight checklist

- [ ] API token: **Workers Scripts: Edit + Secrets Store: Edit & Read + Account Settings: Read** (G1)
- [ ] Shared state bootstrapped: `bunx alchemy cloudflare bootstrap`
- [ ] Repo secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, **`GOLEMIO_API_TOKEN`** (T8)
- [ ] Repo variable `CF_WORKERS_SUBDOMAIN` = `i11v`, confirmed not inferred (T6)
- [ ] `@effect/platform-bun` pinned as an explicit devDependency (T2)
- [ ] Worker stage read from `process.env.TABLO_STAGE`, props are a **static object** — no `Alchemy.Stage` in the Worker definition (T1)
- [ ] `TABLO_STAGE` exported in every deploy/destroy workflow step (T1)
- [ ] Worker `name` is stage-aware via `workerName()` (G2)
- [ ] CI builds `build:index` → `build:web` before deploy (T7)
- [ ] `/api/health` smoke test gates both workflows (T3)
- [ ] `cancel-in-progress: false` on deploy + preview (G6)
- [ ] Production deploys run **only in CI** — no laptop/worktree prod deploys (G4/T5)
- [ ] No `destroy --stage production`, ever (T4)
