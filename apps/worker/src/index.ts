/// <reference types="node" />
import * as Alchemy from "alchemy"
import * as Cloudflare from "alchemy/Cloudflare"
import { Config, Effect, Layer, Redacted } from "effect"
import * as HttpServerRequest from "effect/http/HttpServerRequest"
import * as HttpServerError from "effect/http/HttpServerError"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import * as HttpRouter from "effect/http/HttpRouter"
import { apiLayer } from "./api.ts"
import { ClientSession } from "./do/session.ts"
import { GolemioGateway } from "./do/gateway.ts"
import { makeTripPlans, TripBucketLoadError } from "./gtfs/plans.ts"
import { resolveWorkerStage, workerDomain, workerName } from "./workerName.ts"

export { ClientSession, GolemioGateway }

// Fallback build identity for local dev. CI binds TABLO_COMMIT to the commit
// SHA at deploy time and the smoke test asserts /api/health reports it — a
// health check that can't tell which build is live passes even when the
// deploy didn't actually take.
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
  DEV_PORT_OVERRIDE === undefined ? undefined : { port: DEV_PORT_OVERRIDE, strictPort: true }

// Deploy-time stage, read at module load. CI sets `TABLO_STAGE` to match the
// `alchemy deploy --stage <…>` value. We deliberately do NOT read the
// `Alchemy.Stage` Context service here: it only exists at deploy/plan time,
// and reading it inside the Worker definition leaks a `Stage` requirement
// into the worker's runtime context, crashing every request with
// "Service not found: Stage". Locally we fall back to alchemy's own default
// (`dev_<user>`) so a stray local deploy can never grab the bare `tablo`
// (production) name.
const WORKER_STAGE = resolveWorkerStage(typeof process !== "undefined" ? (process.env ?? {}) : {})
// Custom hostname for this stage (production → tablo.run, pr-N →
// preview-N.tablo.run), or undefined for workers.dev-only stages.
const WORKER_DOMAIN = workerDomain(WORKER_STAGE)

// Traces and logs go to Honeycomb as service `tablo-worker`, in the same
// environment as the iOS app's `tablo-ios`: the app sends a W3C traceparent
// with every request, so one trace runs from the tap on the phone through the
// Worker and the gateway DO to Golemio. The ingest key is read from the deploy
// environment (like TABLO_STAGE, at module load) and bound onto the worker as
// a secret; a deploy without HONEYCOMB_API_KEY exports nothing. Alchemy builds
// the exporter per event and flushes it in waitUntil, so it never delays a
// response. Workers Logs (console, exceptions) are on by Alchemy's default.
const HONEYCOMB_API_KEY =
  typeof process !== "undefined" ? process.env?.HONEYCOMB_API_KEY : undefined
// EU region, like the app; US accounts set https://api.honeycomb.io.
const HONEYCOMB_API =
  (typeof process !== "undefined" ? process.env?.HONEYCOMB_API_URL : undefined) ??
  "https://api.eu1.honeycomb.io"
const telemetry = HONEYCOMB_API_KEY
  ? (() => {
      // per-signal entries ignore the shared `headers`, so each carries the key
      const headers = { "x-honeycomb-team": Redacted.make(HONEYCOMB_API_KEY) }
      return Alchemy.Telemetry.layerOtlp({
        // no metrics: nothing records any yet
        traces: { url: `${HONEYCOMB_API}/v1/traces`, headers },
        logs: { url: `${HONEYCOMB_API}/v1/logs`, headers },
        serviceName: "tablo-worker",
      })
    })()
  : Layer.empty

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
      directory: "./apps/web/dist",
      notFoundHandling: "single-page-application",
      // Production-correct: /api/* hits the worker first, everything else is
      // served by the Cloudflare assets router (with the SPA fallback).
      // /data/* also goes worker-first so a missing hashed stop-index file
      // can be answered with a real 404 instead of the SPA fallback HTML —
      // see the /data/ branch in fetch below.
      runWorkerFirst: ["/api/*", "/data/*"],
    },
    // Stage-aware custom hostname (see workerDomain): production answers on the
    // apex `tablo.run`, each PR preview on `preview-<N>.tablo.run`. The zone is
    // inferred from the hostname; Alchemy provisions the DNS record + TLS cert
    // on deploy. Stages without a domain (local dev) stay workers.dev-only
    // (`workersDev` defaults to on). Each preview owns its own hostname, so previews can
    // never collide with — or grab — production's domain.
    ...(WORKER_DOMAIN ? { domain: WORKER_DOMAIN } : {}),
    ...(devOptions ? { dev: devOptions } : {}),
  },
  Effect.gen(function* () {
    const sessions = yield* ClientSession
    const gateways = yield* GolemioGateway
    const version = yield* Config.String("TABLO_COMMIT").pipe(
      Config.withDefault(VERSION),
      Effect.orDie,
    )
    // Trips and vehicles go through the same singleton gateway DO as the
    // boards, so every upstream call shares its rate budget and caches.
    // Trip plans ship as static assets built from GTFS at deploy time
    // (scripts/build-stop-index.ts), read here through the ASSETS binding.
    // `env` is only populated at exec phase, so read the binding lazily.
    const env = yield* Cloudflare.WorkerEnvironment
    const plans = yield* makeTripPlans((path) =>
      Effect.tryPromise({
        try: async () => {
          const assets = (env as Record<string, AssetsFetcher>).ASSETS
          const res = await assets.fetch(new Request("https://assets.local" + path))
          // A missing file is a 404, or the SPA fallback's index.html.
          const json = (res.headers.get("content-type") ?? "").includes("application/json")
          if (res.status === 404 || (res.ok && !json)) return undefined
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return (await res.json()) as unknown
        },
        catch: (cause) => new TripBucketLoadError({ path, cause }),
      }),
    )
    const apiHandler = yield* HttpRouter.toHttpEffect(
      apiLayer(version, () => gateways.getByName("singleton"), plans),
    )

    return {
      fetch: Effect.gen(function* () {
        const req = yield* HttpServerRequest.HttpServerRequest
        const url = new URL(req.url, "http://local")
        if (url.pathname === "/api/ws") {
          // Plain GETs (crawlers, preloaders, curl) would otherwise reach the
          // DO, where upgrade() dies — a 500 plus log noise for what is just
          // a non-WebSocket request. Answer 426 here instead.
          if (req.headers["upgrade"]?.toLowerCase() !== "websocket") {
            return HttpServerResponse.text("expected websocket upgrade", {
              status: 426,
            })
          }
          const session = url.searchParams.get("session")
          if (session === null || session.length === 0 || session.length > 100) {
            return HttpServerResponse.text("missing session id", { status: 400 })
          }
          return yield* sessions.getByName(session).fetch(req)
        }
        if (url.pathname.startsWith("/api/")) {
          // HttpApi rejects malformed input (a bad bbox or trip id) by dying
          // with a Respondable error that renders as 400. Render causes the way
          // an Effect HTTP server does, rather than letting the Worker runtime
          // turn every defect into a bare 500.
          return yield* apiHandler.pipe(
            Effect.catchCause((cause) =>
              Effect.flatMap(HttpServerError.causeResponse(cause), ([response, rest]) =>
                response.status >= 500
                  ? Effect.as(Effect.logError("api request failed", rest), response)
                  : Effect.succeed(response),
              ),
            ),
          )
        }
        if (url.pathname.startsWith("/data/")) {
          // Old hashed stop-index files disappear from assets on every deploy,
          // and SPA notFoundHandling turns that miss into index.html + 200.
          // The web app's service worker caches /data responses CacheFirst for
          // 60 days, so letting the fallback through would poison that cache
          // with HTML where JSON is expected. Surface misses as real 404s.
          const env = yield* Cloudflare.WorkerEnvironment
          const assets = (env as Record<string, AssetsFetcher>).ASSETS
          const res = yield* Effect.tryPromise(() => assets.fetch(req.source as Request)).pipe(
            Effect.orDie,
          )
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
        const res = yield* Effect.tryPromise(() => assets.fetch(req.source as Request)).pipe(
          Effect.orDie,
        )
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
  }).pipe(Effect.provide(telemetry)),
) {}

interface AssetsFetcher {
  fetch: (request: Request) => Promise<Response>
}
