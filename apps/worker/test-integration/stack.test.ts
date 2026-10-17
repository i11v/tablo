/**
 * Full-stack integration tests: real Worker + GolemioGateway DO + ClientSession
 * DO running on local workerd, driven over HTTP and WebSocket.
 *
 * Why we drive a real `bun alchemy dev` stack (see global-setup.ts) instead of
 * Alchemy's own `alchemy/Test/Vitest` harness: at the pinned versions the
 * harness is broken upstream. Its local-dev LoopbackServer reads
 * `server.address()` as `null` (@distilled.cloud/cloudflare-runtime@0.10.5,
 * LoopbackServer.ts:146), so every request routed through the harness 502s and
 * no assertion can reach the worker. Rather than touch or float that package,
 * the global setup boots the exact same Stack via `bun alchemy dev` on an
 * isolated `integration` stage and a dedicated port, then hands us its base URL
 * in TABLO_INTEGRATION_URL. This still fulfils the plan's intent — the real
 * Worker and both Durable Objects are exercised end-to-end on local workerd —
 * and with the dummy CI token the WS pipeline proves itself via the degraded
 * path, so no Golemio key is needed.
 */
import { expect, test, beforeAll } from "vitest"
import WebSocket from "ws"
import { Schema } from "effect"
import { ServerMessageJson } from "@app/contract"

let baseUrl: string

beforeAll(() => {
  const url = process.env.TABLO_INTEGRATION_URL
  if (!url) {
    throw new Error("TABLO_INTEGRATION_URL is not set — global setup did not start the stack.")
  }
  baseUrl = url
})

test("health endpoint answers", async () => {
  const res = await fetch(baseUrl + "/api/health")
  expect(res.status).toBe(200)
  const body = (await res.json()) as { ok: boolean }
  expect(body.ok).toBe(true)
})

test("ws answers a plain (non-upgrade) request with 426", async () => {
  // The upgrade check runs before the session-id check, so a plain fetch can
  // only ever see 426 (PR #6 added the 426 branch; this test predated it and
  // expected 400, but CI never runs the integration suite, so it sat broken).
  const res = await fetch(baseUrl + "/api/ws")
  expect(res.status).toBe(426)
})

test("subscribe over ws yields a decodable DeparturesUpdate", async () => {
  const wsUrl = baseUrl.replace(/^http/, "ws") + "/api/ws?session=itest-1"
  const frame = await new Promise<string>((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error("no message within 30s"))
    }, 30_000)
    ws.on("open", () =>
      ws.send(
        JSON.stringify({
          _tag: "Subscribe",
          selectors: [{ node: 1040, stops: null }],
        }),
      ),
    )
    ws.on("message", (data) => {
      clearTimeout(timer)
      ws.close()
      resolve(String(data))
    })
    ws.on("error", (e) => {
      clearTimeout(timer)
      reject(e)
    })
  })

  const msg = Schema.decodeUnknownSync(ServerMessageJson)(frame)
  expect(msg._tag).toBe("DeparturesUpdate")
  // Narrow for the field assertions below; the expect above already proves the tag.
  if (msg._tag !== "DeparturesUpdate") throw new Error(`unexpected tag: ${msg._tag}`)

  // Both paths prove the pipeline end-to-end. With the dummy CI token and a
  // cold cache the gateway has no stale data to serve, so it degrades to an
  // empty board set (`degraded: true`, `boards: []`). With a real token the
  // live boards come back and the subscribed selector's key ("1040") is
  // present. Assert the invariant that holds either way: it's degraded, or the
  // subscribed board key came back.
  expect(typeof msg.degraded).toBe("boolean")
  expect(msg.degraded || msg.boards.some((b) => b.key === "1040")).toBe(true)
})
