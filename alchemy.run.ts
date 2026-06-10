import * as Alchemy from "alchemy"
import * as Cloudflare from "alchemy/Cloudflare"
import * as Effect from "effect/Effect"
import Server from "./packages/worker/src/index.ts"
import { resolveWorkerStage, workerName } from "./packages/worker/src/workerName.ts"

export default Alchemy.Stack(
  "tablo",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    // The worker's *name* comes from TABLO_STAGE (process.env, read at module
    // load in packages/worker/src/index.ts — see the note there for why it
    // cannot use this Stage service), while the *state scope* comes from the
    // `--stage` flag. If the two disagree — e.g. a manual
    // `alchemy deploy --stage production` without TABLO_STAGE set — alchemy
    // would see a renamed worker inside the production scope and replace the
    // live `tablo` worker with a dev-named one. Reading Stage here is safe
    // (plan time only) — fail fast before any resource is touched.
    const stage = yield* Alchemy.Stage
    const bundleStage = resolveWorkerStage(process.env)
    if (stage !== bundleStage) {
      return yield* Effect.die(
        new Error(
          `Stage mismatch: --stage is "${stage}" but the worker bundle resolved ` +
            `"${bundleStage}" (TABLO_STAGE=${process.env.TABLO_STAGE ?? "<unset>"}), ` +
            `which would deploy worker "${workerName(bundleStage)}" into the ` +
            `"${stage}" state scope and replace "${workerName(stage)}". ` +
            `Set TABLO_STAGE="${stage}" and retry.`,
        ),
      )
    }
    const server = yield* Server
    return { url: server.url }
  }),
)
