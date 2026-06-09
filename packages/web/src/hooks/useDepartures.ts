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

/**
 * Pure state transition for an incoming server frame. ServerError marks the
 * feed degraded and carries the message into `reason` — swallowing it would
 * leave the UI on "live" with boards stuck on "waiting for live data".
 */
export const applyServerMessage = (
  state: DeparturesState,
  msg: ServerMessage,
): DeparturesState => {
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
          selectors.length === 0
            ? { _tag: "Unsubscribe" }
            : { _tag: "Subscribe", selectors },
        ),
      )
    }
  }, [selectors])

  useEffect(() => {
    let attempt = 0
    let closed = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const connect = (): void => {
      const proto = location.protocol === "https:" ? "wss" : "ws"
      const ws = new WebSocket(
        proto + "://" + location.host + "/api/ws?session=" + sessionId(),
      )
      wsRef.current = ws
      ws.onopen = () => {
        attempt = 0
        const current = selectorsRef.current
        if (current.length > 0) {
          ws.send(encodeClient({ _tag: "Subscribe", selectors: current }))
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
        if (closed) return
        setState((s) => ({ ...s, status: "reconnecting" }))
        const delay = Math.min(30_000, 1000 * 2 ** attempt++)
        timer = setTimeout(connect, delay)
      }
    }

    connect()
    return () => {
      closed = true
      if (timer !== undefined) clearTimeout(timer)
      wsRef.current?.close()
    }
  }, [])

  return state
}
