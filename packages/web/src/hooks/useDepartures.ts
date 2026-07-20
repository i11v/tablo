import { useEffect, useRef, useState } from "react"
import { Schema } from "effect"
import {
  ClientMessageJson,
  ServerMessageJson,
  type ServerMessage,
  type StopBoard,
  type StopSelector,
  type VehiclePosition,
} from "@app/contract"
import { sessionId } from "../lib/storage.ts"

export type WsStatus = "connecting" | "live" | "degraded" | "reconnecting"

export interface DeparturesState {
  readonly status: WsStatus
  readonly boards: ReadonlyMap<string, StopBoard>
  readonly reason: string | null
  readonly vehicles: ReadonlyArray<VehiclePosition>
  readonly vehiclesAt: string | null
}

const encodeClient = Schema.encodeUnknownSync(ClientMessageJson)
const decodeServer = Schema.decodeUnknownSync(ServerMessageJson)

/** How long a connection must stay open before the backoff counter resets. */
const STABLE_AFTER_MS = 10_000

/**
 * Exponential backoff with jitter: 50–100% of the 1s·2^attempt step, capped
 * at 30s. Jitter keeps many clients from reconnecting in lockstep after a
 * server-side blip.
 */
export const reconnectDelay = (attempt: number, random: () => number = Math.random): number => {
  const base = Math.min(30_000, 1000 * 2 ** attempt)
  return base / 2 + random() * (base / 2)
}

/**
 * Pure state transition for an incoming server frame. ServerError marks the
 * feed degraded and carries the message into `reason` — swallowing it would
 * leave the UI on "live" with boards stuck on "waiting for live data".
 */
export const applyServerMessage = (state: DeparturesState, msg: ServerMessage): DeparturesState => {
  switch (msg._tag) {
    case "DeparturesUpdate":
      return {
        ...state,
        status: msg.degraded ? "degraded" : "live",
        boards: new Map(msg.boards.map((b) => [b.key, b])),
        reason: msg.reason,
      }
    case "VehiclesUpdate":
      return {
        ...state,
        status: msg.degraded ? "degraded" : "live",
        vehicles: msg.vehicles,
        vehiclesAt: msg.generatedAt,
        reason: msg.reason,
      }
    case "ServerError":
      return { ...state, status: "degraded", reason: msg.message }
  }
}

/** Owns the WS lifecycle: connect, subscribe, reconnect with backoff, re-subscribe. */
export const useDepartures = (
  selectors: ReadonlyArray<StopSelector>,
  vehicleRoutes: ReadonlyArray<string> = [],
): DeparturesState => {
  const [state, setState] = useState<DeparturesState>({
    status: "connecting",
    boards: new Map(),
    reason: null,
    vehicles: [],
    vehiclesAt: null,
  })
  const wsRef = useRef<WebSocket | null>(null)
  const selectorsRef = useRef(selectors)
  selectorsRef.current = selectors
  const vehicleRoutesRef = useRef(vehicleRoutes)
  vehicleRoutesRef.current = vehicleRoutes
  // Last payload sent over the *current* socket. Selector arrays are often
  // rebuilt with identical contents (memo identity churn); comparing encoded
  // frames keeps those from re-triggering a server-side poll cycle.
  const lastSentRef = useRef<string | null>(null)
  // Same dedupe, kept separate so a selector-only re-render doesn't touch
  // the vehicle subscription's last-sent frame (and vice versa).
  const lastSentVehiclesRef = useRef<string | null>(null)

  // (re)subscribe when the selection changes, over the existing socket
  useEffect(() => {
    const ws = wsRef.current
    if (ws !== null && ws.readyState === WebSocket.OPEN) {
      const payload = encodeClient(
        selectors.length === 0 ? { _tag: "Unsubscribe" } : { _tag: "Subscribe", selectors },
      )
      if (payload === lastSentRef.current) return
      lastSentRef.current = payload
      ws.send(payload)
    }
  }, [selectors])

  // (re)subscribe to the vehicle feed when the route filter changes, over the
  // existing socket — mirrors the selectors effect above.
  useEffect(() => {
    const ws = wsRef.current
    if (ws !== null && ws.readyState === WebSocket.OPEN) {
      const payload = encodeClient(
        vehicleRoutes.length === 0
          ? { _tag: "UnsubscribeVehicles" }
          : { _tag: "SubscribeVehicles", routes: vehicleRoutes },
      )
      if (payload === lastSentVehiclesRef.current) return
      lastSentVehiclesRef.current = payload
      ws.send(payload)
    }
  }, [vehicleRoutes])

  useEffect(() => {
    let attempt = 0
    let closed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let stableTimer: ReturnType<typeof setTimeout> | undefined

    const connect = (): void => {
      const proto = location.protocol === "https:" ? "wss" : "ws"
      const ws = new WebSocket(proto + "://" + location.host + "/api/ws?session=" + sessionId())
      wsRef.current = ws
      ws.onopen = () => {
        // Reset the backoff only once the link has proven stable. Resetting
        // here unconditionally turns an accept-then-drop loop (worker
        // redeploy/crash right after upgrade) into a fixed ~1s storm.
        stableTimer = setTimeout(() => {
          attempt = 0
        }, STABLE_AFTER_MS)
        // Always make the server-side subscription explicit. The session DO
        // outlives individual sockets within a tab, so reconnecting after
        // the user cleared their stops must send Unsubscribe — staying
        // silent would leave the old subscription polling server-side.
        const current = selectorsRef.current
        const payload = encodeClient(
          current.length > 0 ? { _tag: "Subscribe", selectors: current } : { _tag: "Unsubscribe" },
        )
        lastSentRef.current = payload
        ws.send(payload)
        // The vehicle feed is opt-in (only the map view subscribes), unlike
        // the board subscription above which always makes its state explicit.
        const currentRoutes = vehicleRoutesRef.current
        if (currentRoutes.length > 0) {
          const vehiclesPayload = encodeClient({ _tag: "SubscribeVehicles", routes: currentRoutes })
          lastSentVehiclesRef.current = vehiclesPayload
          ws.send(vehiclesPayload)
        }
        setState((s) => ({ ...s, status: "live" }))
      }
      ws.onmessage = (event) => {
        try {
          const msg = decodeServer(String(event.data))
          setState((s) => applyServerMessage(s, msg))
        } catch {
          // ignore undecodable frames
        }
      }
      ws.onclose = () => {
        if (stableTimer !== undefined) {
          clearTimeout(stableTimer)
          stableTimer = undefined
        }
        if (closed) return
        setState((s) => ({ ...s, status: "reconnecting" }))
        timer = setTimeout(connect, reconnectDelay(attempt++))
      }
    }

    connect()
    return () => {
      closed = true
      if (timer !== undefined) clearTimeout(timer)
      if (stableTimer !== undefined) clearTimeout(stableTimer)
      wsRef.current?.close()
    }
  }, [])

  return state
}
