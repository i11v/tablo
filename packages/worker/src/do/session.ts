import * as Cloudflare from "alchemy/Cloudflare"
import { Cause, Effect, Schema } from "effect"
import {
  ClientMessageJson,
  ServerMessageJson,
  type ServerMessage,
  type StopSelector,
} from "@app/contract"
import { GolemioGateway } from "./gateway.ts"
import { planTick } from "./cadence.ts"

const STORAGE_KEY = "selectors"
const ROUTES_KEY = "vehicleRoutes"
const BOARDS_DUE_KEY = "boardsDueAt"

const encodeServer = Schema.encodeUnknownSync(ServerMessageJson)
const decodeClient = Schema.decodeUnknownSync(ClientMessageJson)

export class ClientSession extends Cloudflare.DurableObject<ClientSession>()(
  "ClientSession",
  Effect.gen(function* () {
    // Outer init: resolve the gateway namespace once.
    const gateway = yield* GolemioGateway

    return Effect.gen(function* () {
      const state = yield* Cloudflare.DurableObjectState

      const broadcast = Effect.fn("ClientSession.broadcast")(function* (message: ServerMessage) {
        const payload = encodeServer(message)
        for (const socket of yield* state.getWebSockets()) {
          yield* socket.send(payload).pipe(Effect.ignore)
        }
      })

      const poll = Effect.fn("ClientSession.poll")(function* () {
        const selectors = (yield* state.storage.get<ReadonlyArray<StopSelector>>(STORAGE_KEY)) ?? []
        const routes = (yield* state.storage.get<ReadonlyArray<string>>(ROUTES_KEY)) ?? []
        const boardsDueAt = (yield* state.storage.get<number>(BOARDS_DUE_KEY)) ?? 0
        const sockets = yield* state.getWebSockets()
        const plan = planTick({
          now: Date.now(),
          hasSelectors: selectors.length > 0,
          hasRoutes: routes.length > 0,
          hasSockets: sockets.length > 0,
          boardsDueAt,
        })
        if (plan.alarmAt === null) {
          yield* state.storage.deleteAlarm()
          return
        }
        // Arm first: guarantee the next tick before the (RPC-stub-)fallible
        // work, so a failed RPC/broadcast can't freeze this session's updates.
        yield* state.storage.setAlarm(plan.alarmAt)
        yield* state.storage.put(BOARDS_DUE_KEY, plan.boardsDueAt)
        if (plan.fetchVehicles) {
          yield* Effect.gen(function* () {
            const result = yield* gateway.getByName("singleton").getVehicles()
            // Other events can interleave at the RPC await above. If the
            // subscription changed mid-flight (Unsubscribe or a new
            // Subscribe), drop this frame — broadcasting it could land
            // *after* the fresh one and briefly show routes the client no
            // longer wants.
            const current = (yield* state.storage.get<ReadonlyArray<string>>(ROUTES_KEY)) ?? []
            if (JSON.stringify(current) !== JSON.stringify(routes)) return
            const wanted = new Set(routes)
            yield* broadcast({
              _tag: "VehiclesUpdate",
              ...result,
              vehicles: result.vehicles.filter((v) => wanted.has(v.routeId)),
            })
          }).pipe(
            // Broad catch (typed failures AND defects, e.g. RpcCallError): a
            // failed tick must not bubble — the alarm is already armed to
            // retry. Isolated per fetch so a failing vehicles fetch can't
            // suppress the boards broadcast below.
            Effect.catchCause(() => Effect.void),
          )
        }
        if (plan.fetchBoards) {
          yield* Effect.gen(function* () {
            const result = yield* gateway.getByName("singleton").getBoards(selectors)
            // Same mid-flight-change guard as above, for the boards fetch.
            const current =
              (yield* state.storage.get<ReadonlyArray<StopSelector>>(STORAGE_KEY)) ?? []
            if (JSON.stringify(current) !== JSON.stringify(selectors)) return
            yield* broadcast({ _tag: "DeparturesUpdate", ...result })
          }).pipe(
            // Broad catch, isolated per fetch: see the vehicles fetch above.
            Effect.catchCause(() => Effect.void),
          )
        }
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
                yield* poll() // immediate first update; poll re-arms the alarm
                break
              }
              case "Unsubscribe": {
                yield* state.storage.put(STORAGE_KEY, [])
                yield* poll() // re-plans: drops departures cadence or stops entirely
                break
              }
              case "SubscribeVehicles": {
                yield* state.storage.put(ROUTES_KEY, msg.routes)
                yield* poll() // immediate first update; poll re-arms the alarm
                break
              }
              case "UnsubscribeVehicles": {
                yield* state.storage.put(ROUTES_KEY, [])
                yield* poll() // re-plans: drops to 15s cadence or stops entirely
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

        alarm: () => poll().pipe(Effect.ignore),
      }
    })
  }),
) {}
