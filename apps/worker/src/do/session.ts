import * as Cloudflare from "alchemy/Cloudflare"
import { Cause, Effect, Schema } from "effect"
import {
  ClientMessageJson,
  ServerMessageJson,
  type ServerMessage,
  type StopSelector,
} from "@app/contract"
import { currentTraceparent, fromTraceparent, linkCurrentSpan, withCallerSpan } from "../trace.ts"
import { GolemioGateway } from "./gateway.ts"

const POLL_MS = 15_000
const STORAGE_KEY = "selectors"

const encodeServer = Schema.encodeUnknownSync(ServerMessageJson)
const decodeClient = Schema.decodeUnknownSync(ClientMessageJson)

export class ClientSession extends Cloudflare.DurableObject<ClientSession>()(
  "ClientSession",
  Effect.gen(function* () {
    // Outer init: resolve the gateway namespace once.
    const gateway = yield* GolemioGateway

    // Returning the inner init Effect is Alchemy's two-phase DO pattern.
    // @effect-diagnostics-next-line returnEffectInGen:off
    return Effect.gen(function* () {
      const state = yield* Cloudflare.DurableObjectState
      // The client span that asked for the current subscription. The first
      // poll runs in its trace; alarm polls link back to it. In memory only:
      // after hibernation, polls simply go unlinked.
      let subscribedBy: string | undefined

      const broadcast = Effect.fn("ClientSession.broadcast")(function* (message: ServerMessage) {
        const payload = encodeServer(message)
        for (const socket of yield* state.getWebSockets()) {
          yield* socket.send(payload).pipe(Effect.ignore)
        }
      })

      const poll = Effect.fn("ClientSession.poll")(function* (trigger: "subscribe" | "alarm") {
        const selectors = (yield* state.storage.get<ReadonlyArray<StopSelector>>(STORAGE_KEY)) ?? []
        const sockets = yield* state.getWebSockets()
        yield* Effect.annotateCurrentSpan({
          "tablo.poll.trigger": trigger,
          "tablo.selectors": selectors.length,
          "tablo.sockets": sockets.length,
        })
        if (trigger === "alarm") {
          yield* linkCurrentSpan([fromTraceparent(subscribedBy)], { "tablo.link": "subscription" })
        }
        if (selectors.length === 0 || sockets.length === 0) {
          yield* Effect.annotateCurrentSpan("tablo.poll.outcome", "idle")
          yield* state.storage.deleteAlarm()
          return
        }
        // Arm first: guarantee the next tick before the (RPC-stub-)fallible
        // work, so a failed RPC/broadcast can't freeze this session's updates.
        yield* state.storage.setAlarm(Date.now() + POLL_MS)
        yield* Effect.gen(function* () {
          const result = yield* gateway
            .getByName("singleton")
            .getBoards(selectors, yield* currentTraceparent)
          // Other events can interleave at the RPC await above. If the
          // subscription changed mid-flight (Unsubscribe or a new Subscribe),
          // drop this frame — broadcasting it could land *after* the fresh
          // one and briefly show boards the client no longer wants.
          const current = (yield* state.storage.get<ReadonlyArray<StopSelector>>(STORAGE_KEY)) ?? []
          if (JSON.stringify(current) !== JSON.stringify(selectors)) {
            yield* Effect.annotateCurrentSpan("tablo.poll.outcome", "superseded")
            return
          }
          yield* broadcast({ _tag: "DeparturesUpdate", ...result })
          yield* Effect.annotateCurrentSpan({
            "tablo.poll.outcome": "sent",
            "tablo.boards": result.boards.length,
            "tablo.degraded": result.degraded,
          })
        }).pipe(
          // Broad catch (typed failures AND defects, e.g. RpcCallError): a
          // failed tick must not bubble — the alarm is already armed to retry.
          Effect.catchCause((cause) =>
            Effect.annotateCurrentSpan({
              "tablo.poll.outcome": "failed",
              "tablo.error": String(Cause.squash(cause)),
            }),
          ),
        )
      })

      return {
        fetch: Effect.gen(function* () {
          const [response] = yield* Cloudflare.upgrade()
          return response
        }),

        webSocketMessage: (socket: Cloudflare.WebSocket, message: string | ArrayBuffer) =>
          Effect.gen(function* () {
            if (typeof message !== "string") return
            const msg = decodeClient(message)
            switch (msg._tag) {
              case "Subscribe": {
                yield* state.storage.put(STORAGE_KEY, msg.selectors)
                subscribedBy = msg.traceparent
                // immediate first update; poll re-arms the alarm
                yield* poll("subscribe").pipe(withCallerSpan(msg.traceparent))
                break
              }
              case "Unsubscribe": {
                yield* state.storage.put(STORAGE_KEY, [])
                yield* state.storage.deleteAlarm()
                subscribedBy = undefined
                break
              }
            }
          }).pipe(
            // Broad catch: typed failures AND defects (e.g. a malformed-JSON
            // decode throw) become a single ServerError frame to the client.
            Effect.catchCause((cause) =>
              socket
                .send(
                  encodeServer({
                    _tag: "ServerError",
                    message: String(Cause.squash(cause)),
                  }),
                )
                .pipe(Effect.ignore),
            ),
          ),

        webSocketClose: (socket: Cloudflare.WebSocket) =>
          Effect.gen(function* () {
            // Filter the closing socket out explicitly (by raw socket — the
            // DurableWebSocket wrappers are re-created per getWebSockets()
            // call): whether the runtime still lists the closing socket
            // during this handler is unspecified timing, and guessing wrong
            // either leaks the session or freezes a still-open tab.
            const others = (yield* state.getWebSockets()).filter((s) => s.ws !== socket.ws)
            if (others.length === 0) {
              // Last socket gone: release everything. A DO with any stored
              // data is retained (and billed) indefinitely, and every tab
              // visit names a fresh session DO — persisting selectors here
              // would leak one orphan DO per visit, forever. Clients re-send
              // Subscribe on every connect, so nothing relies on this state.
              // deleteAll() does not clear the alarm; delete it explicitly.
              yield* state.storage.deleteAlarm()
              yield* state.storage.deleteAll()
            }
          }).pipe(Effect.ignore),

        alarm: () => poll("alarm").pipe(Effect.ignore),
      }
    })
  }),
) {}
