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

export { ClientSession, GolemioGateway }

const VERSION = "0.1.0"

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
    main: import.meta.filename,
    compatibility: { date: "2026-06-01", flags: ["nodejs_compat"] },
    assets: {
      directory: "./packages/web/dist",
      notFoundHandling: "single-page-application",
      // Production-correct: /api/* hits the worker first, everything else is
      // served by the Cloudflare assets router (with the SPA fallback).
      runWorkerFirst: ["/api/*"],
    },
    url: true,
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
