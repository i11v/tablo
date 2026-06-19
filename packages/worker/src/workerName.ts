/**
 * Stage-aware Cloudflare Worker name. Production keeps the bare name so its
 * workers.dev URL is stable; every other stage (PR previews, local dev) is
 * suffixed so it can never collide with — or overwrite — production.
 *
 *   production  -> tablo
 *   pr-42       -> tablo-pr-42
 *   dev_ilnur   -> tablo-dev_ilnur
 */
export const workerName = (stage: string): string =>
  stage === "production" ? "tablo" : `tablo-${stage}`

/**
 * Stage-aware Cloudflare **custom domain**, or `undefined` for stages that are
 * only reachable on their `*.workers.dev` URL (local dev, ad-hoc stages).
 *
 *   production  -> tablo.run                (apex; the canonical home)
 *   pr-42       -> preview-42.tablo.run      (per-PR preview hostname)
 *   dev_ilnur   -> undefined                 (workers.dev only)
 *
 * Co-located with {@link workerName} so a stage's worker name and public
 * hostname are derived in one place. The worker *name* still uses the `pr-`
 * scheme (`tablo-pr-42`); only the public hostname reads `preview-`. The
 * `tablo.run` zone must exist in the account — Alchemy infers the zone from
 * the hostname and provisions the proxied DNS record + TLS cert on deploy.
 *
 * NOTE: a preview's domain is deleted on teardown (and switching production's
 * domain deletes the previous one), which trips a beta CF-client bug on the
 * empty-body DELETE response — fixed by the @distilled.cloud/core patch in
 * `patches/`. Drop that patch only once the upstream fix ships.
 */
export const workerDomain = (stage: string): string | undefined => {
  if (stage === "production") return "tablo.run"
  const pr = /^pr-(\d+)$/.exec(stage)
  return pr ? `preview-${pr[1]}.tablo.run` : undefined
}

/**
 * The stage the worker *bundle* believes it is deploying to: `TABLO_STAGE`
 * if set, otherwise alchemy's own local default (`dev_<user>`), otherwise
 * "local". Kept here — next to {@link workerName} — so alchemy.run.ts can
 * verify at plan time that this agrees with the actual `--stage` flag; the
 * two come from different channels (process.env vs CLI flag) and a mismatch
 * would rename, and thereby replace, the deployed worker.
 */
export const resolveWorkerStage = (env: {
  TABLO_STAGE?: string
  USER?: string
}): string => env.TABLO_STAGE || (env.USER ? `dev_${env.USER}` : "local")
