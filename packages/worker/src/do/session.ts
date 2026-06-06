import * as Cloudflare from "alchemy/Cloudflare"
import { Cause, Effect, Schema } from "effect"
import {
  ClientMessageJson,
  ServerMessageJson,
  type ServerMessage,
  type StopSelector,
} from "@app/contract"
import { GolemioGateway } from "./gateway.ts"

const POLL_MS = 15_000
const STORAGE_KEY = "selectors"

const encodeServer = Schema.encodeUnknownSync(ServerMessageJson)
const decodeClient = Schema.decodeUnknownSync(ClientMessageJson)

export class ClientSession extends Cloudflare.DurableObjectNamespace<ClientSession>()(
  "ClientSession",
  Effect.gen(function* () {
    // Outer init: resolve the gateway namespace once.
    const gateway = yield* GolemioGateway

    return Effect.gen(function* () {
      const state = yield* Cloudflare.DurableObjectState

      const broadcast = Effect.fn("ClientSession.broadcast")(
        function* (message: ServerMessage) {
          const payload = encodeServer(message)
          for (const socket of yield* state.getWebSockets()) {
            yield* socket.send(payload).pipe(Effect.ignore)
          }
        },
      )

      const poll = Effect.fn("ClientSession.poll")(function* () {
        const selectors =
          (yield* state.storage.get<ReadonlyArray<StopSelector>>(STORAGE_KEY)) ?? []
        const sockets = yield* state.getWebSockets()
        if (selectors.length === 0 || sockets.length === 0) {
          yield* state.storage.deleteAlarm()
          return
        }
        const result = yield* gateway.getByName("singleton").getBoards(selectors)
        yield* broadcast({ _tag: "DeparturesUpdate", ...result })
        yield* state.storage.setAlarm(Date.now() + POLL_MS)
      })

      return {
        fetch: Effect.gen(function* () {
          const [response] = yield* Cloudflare.upgrade()
          return response
        }),

        webSocketMessage: (
          socket: Cloudflare.DurableWebSocket,
          message: string | ArrayBuffer,
        ) =>
          Effect.gen(function* () {
            if (typeof message !== "string") return
            const msg = decodeClient(message)
            switch (msg._tag) {
              case "Subscribe": {
                yield* state.storage.put(STORAGE_KEY, msg.selectors)
                yield* poll() // immediate first update; poll re-arms the alarm
                break
              }
              case "Unsubscribe": {
                yield* state.storage.put(STORAGE_KEY, [])
                yield* state.storage.deleteAlarm()
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

        webSocketClose: (_socket: Cloudflare.DurableWebSocket) =>
          Effect.gen(function* () {
            const remaining = yield* state.getWebSockets()
            if (remaining.length <= 1) {
              yield* state.storage.deleteAlarm()
            }
          }).pipe(Effect.ignore),

        alarm: () => poll().pipe(Effect.ignore),
      }
    })
  }),
) {}
