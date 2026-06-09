/// <reference types="node" />
import * as Cloudflare from "alchemy/Cloudflare"
import { Effect, Layer } from "effect"
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest"
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import * as HttpPlatform from "effect/unstable/http/HttpPlatform"
import * as Etag from "effect/unstable/http/Etag"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "@app/contract"
import { ClientSession } from "./do/session.ts"
import { GolemioGateway } from "./do/gateway.ts"
import { resolveWorkerStage, workerName } from "./workerName.ts"

export { ClientSession, GolemioGateway }

const VERSION = "0.1.0"

// Local dev server port. Defaults to Alchemy's 1337 so `bun alchemy dev` keeps
// its usual behaviour. The integration suite sets TABLO_DEV_PORT to a dedicated
// port (with strictPort) so it can run an isolated stack without ever colliding
// with a developer's own `bun alchemy dev` on 1337.
const DEV_PORT_OVERRIDE =
  typeof process !== "undefined" && process.env?.TABLO_DEV_PORT
    ? Number(process.env.TABLO_DEV_PORT)
    : undefined
const devOptions =
  DEV_PORT_OVERRIDE === undefined
    ? undefined
    : { port: DEV_PORT_OVERRIDE, strictPort: true }

// Deploy-time stage, read at module load. CI sets `TABLO_STAGE` to match the
// `alchemy deploy --stage <…>` value. We deliberately do NOT read the
// `Alchemy.Stage` Context service here: it only exists at deploy/plan time,
// and reading it inside the Worker definition leaks a `Stage` requirement
// into the worker's runtime context, crashing every request with
// "Service not found: Stage". Locally we fall back to alchemy's own default
// (`dev_<user>`) so a stray local deploy can never grab the bare `tablo`
// (production) name.
const WORKER_STAGE = resolveWorkerStage(
  typeof process !== "undefined" ? (process.env ?? {}) : {},
)

const systemHandlers = HttpApiBuilder.group(Api, "system", (handlers) =>
  handlers.handle("health", () => Effect.succeed({ ok: true, version: VERSION })),
)

const apiLayer = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(systemHandlers),
  Layer.provide([HttpPlatform.layer, Etag.layer]),
)

export default class Server extends Cloudflare.Worker<Server>()(
  "Server",
  {
    // Stage-aware name: production keeps the bare `tablo` (stable workers.dev
    // URL); every other stage is suffixed so a preview can never overwrite it.
    // `name` is computed from WORKER_STAGE (process.env, read at module load) —
    // see the note there for why this must not use the `Alchemy.Stage` service.
    name: workerName(WORKER_STAGE),
    main: import.meta.filename,
    compatibility: { date: "2026-06-01", flags: ["nodejs_compat"] },
    assets: {
      directory: "./packages/web/dist",
      notFoundHandling: "single-page-application",
      // Production-correct: /api/* hits the worker first, everything else is
      // served by the Cloudflare assets router (with the SPA fallback).
      // /data/* also goes worker-first so a missing hashed stop-index file
      // can be answered with a real 404 instead of the SPA fallback HTML —
      // see the /data/ branch in fetch below.
      runWorkerFirst: ["/api/*", "/data/*"],
    },
    url: true,
    ...(devOptions ? { dev: devOptions } : {}),
  },
  Effect.gen(function* () {
    const sessions = yield* ClientSession
    yield* GolemioGateway // bind the namespace even though only ClientSession calls it
    const apiHandler = yield* HttpRouter.toHttpEffect(apiLayer)

    return {
      fetch: Effect.gen(function* () {
        const req = yield* HttpServerRequest.HttpServerRequest
        const url = new URL(req.url, "http://local")
        if (url.pathname === "/api/ws") {
          const session = url.searchParams.get("session")
          if (session === null || session.length === 0 || session.length > 100) {
            return HttpServerResponse.text("missing session id", { status: 400 })
          }
          return yield* sessions.getByName(session).fetch(req)
        }
        if (url.pathname.startsWith("/api/")) {
          return yield* apiHandler
        }
        if (url.pathname.startsWith("/data/")) {
          // Old hashed stop-index files disappear from assets on every deploy,
          // and SPA notFoundHandling turns that miss into index.html + 200.
          // The web app's service worker caches /data responses CacheFirst for
          // 60 days, so letting the fallback through would poison that cache
          // with HTML where JSON is expected. Surface misses as real 404s.
          const env = yield* Cloudflare.WorkerEnvironment
          const assets = (env as Record<string, AssetsFetcher>).ASSETS
          const res = yield* Effect.tryPromise(() =>
            assets.fetch(req.source as Request),
          ).pipe(Effect.orDie)
          const contentType = res.headers.get("content-type") ?? ""
          if (res.status === 200 && contentType.includes("text/html")) {
            return HttpServerResponse.text("not found", { status: 404 })
          }
          return HttpServerResponse.fromWeb(res)
        }
        // Non-/api routes: delegate to the ASSETS binding. In production the
        // assets router serves these before they ever reach the worker; this
        // branch is the in-worker fallback for runtimes that invoke the user
        // worker ahead of assets.
        const env = yield* Cloudflare.WorkerEnvironment
        const assets = (env as Record<string, AssetsFetcher>).ASSETS
        const res = yield* Effect.tryPromise(() =>
          assets.fetch(req.source as Request),
        ).pipe(Effect.orDie)
        const bytes = new Uint8Array(
          yield* Effect.tryPromise(() => res.arrayBuffer()).pipe(Effect.orDie),
        )
        const contentType = res.headers.get("content-type") ?? undefined
        return HttpServerResponse.uint8Array(bytes, {
          status: res.status,
          ...(contentType ? { contentType } : {}),
        })
      }),
    }
  }),
) {}

interface AssetsFetcher {
  fetch: (request: Request) => Promise<Response>
}
