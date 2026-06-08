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
