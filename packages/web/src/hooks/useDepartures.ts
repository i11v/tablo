import { useEffect, useRef, useState } from "react"
import { Schema } from "effect"
import {
  ClientMessageJson,
  ServerMessageJson,
  type ServerMessage,
  type StopBoard,
  type StopSelector,
} from "@app/contract"
import { sessionId } from "../lib/storage.ts"

export type WsStatus = "connecting" | "live" | "degraded" | "reconnecting"

export interface DeparturesState {
  readonly status: WsStatus
  readonly boards: ReadonlyMap<string, StopBoard>
  readonly reason: string | null
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
        status: msg.degraded ? "degraded" : "live",
        boards: new Map(msg.boards.map((b) => [b.key, b])),
        reason: msg.reason,
      }
    case "ServerError":
      return { ...state, status: "degraded", reason: msg.message }
  }
}

/** Owns the WS lifecycle: connect, subscribe, reconnect with backoff, re-subscribe. */
export const useDepartures = (selectors: ReadonlyArray<StopSelector>): DeparturesState => {
  const [state, setState] = useState<DeparturesState>({
    status: "connecting",
    boards: new Map(),
    reason: null,
  })
  const wsRef = useRef<WebSocket | null>(null)
  const selectorsRef = useRef(selectors)
  selectorsRef.current = selectors

  // (re)subscribe when the selection changes, over the existing socket
  useEffect(() => {
    const ws = wsRef.current
    if (ws !== null && ws.readyState === WebSocket.OPEN) {
      ws.send(
        encodeClient(
          selectors.length === 0 ? { _tag: "Unsubscribe" } : { _tag: "Subscribe", selectors },
        ),
      )
    }
  }, [selectors])

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
        ws.send(
          encodeClient(
            current.length > 0
              ? { _tag: "Subscribe", selectors: current }
              : { _tag: "Unsubscribe" },
          ),
        )
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
