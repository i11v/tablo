/// <reference types="node" />
import * as Cloudflare from "alchemy/Cloudflare"
import { Config, Effect, Redacted } from "effect"
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest"
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse"

export class ClientSession extends Cloudflare.DurableObjectNamespace<ClientSession>()(
  "ClientSession",
  Effect.gen(function* () {
    // outer init — nothing shared yet
    return Effect.gen(function* () {
      const state = yield* Cloudflare.DurableObjectState
      return {
        ping: () =>
          Effect.gen(function* () {
            const n = ((yield* state.storage.get<number>("n")) ?? 0) + 1
            yield* state.storage.put("n", n)
            return `pong ${n}`
          }),
      }
    })
  }),
) {}

export class GolemioGateway extends Cloudflare.DurableObjectNamespace<GolemioGateway>()(
  "GolemioGateway",
  Effect.gen(function* () {
    // `Config.redacted` registers the secret binding at deploy and resolves it
    // at cold start; `orDie` discharges the `ConfigError` the DO init phase
    // forbids (the namespace `make` requires a `never` error channel).
    const token = yield* Config.redacted("GOLEMIO_API_TOKEN").pipe(Effect.orDie)
    return Effect.gen(function* () {
      return {
        tokenPresent: () => Effect.succeed(Redacted.value(token).length > 0),
      }
    })
  }),
) {}

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
    const gateway = yield* GolemioGateway
    return {
      fetch: Effect.gen(function* () {
        const req = yield* HttpServerRequest.HttpServerRequest
        const url = new URL(req.url, "http://local")
        if (url.pathname === "/api/health") {
          return HttpServerResponse.jsonUnsafe({ ok: true })
        }
        if (url.pathname === "/api/do-ping") {
          const msg = yield* sessions.getByName("skeleton").ping()
          return HttpServerResponse.text(msg)
        }
        if (url.pathname === "/api/token-check") {
          const present = yield* gateway.getByName("singleton").tokenPresent()
          return HttpServerResponse.jsonUnsafe({ present })
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
