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
