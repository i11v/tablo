import * as Alchemy from "alchemy"
import * as Cloudflare from "alchemy/Cloudflare"
import * as Effect from "effect/Effect"
import Server from "./packages/worker/src/index.ts"

export default Alchemy.Stack(
  "tablo",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const server = yield* Server
    return { url: server.url }
  }),
)
