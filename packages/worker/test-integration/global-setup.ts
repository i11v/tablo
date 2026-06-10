/**
 * Vitest globalSetup for the full-stack integration suite.
 *
 * Why a real `bun alchemy dev` instead of Alchemy's own test harness
 * (`alchemy/Test/Vitest`):
 * That harness deploys the Stack to local workerd and drives it over HTTP/WS,
 * which is exactly what we want — but it is broken upstream at the pinned
 * versions. Its local-dev LoopbackServer reads `server.address()` as `null`
 * (@distilled.cloud/cloudflare-runtime@0.10.5, LoopbackServer.ts:146) so every
 * request through the harness 502s and no test can reach the worker. We do not
 * touch or float that package. Instead we drive the *same* stack the way it
 * provably works: a child `bun alchemy dev` process running real workerd with
 * both Durable Objects, an isolated `integration` stage, and a dedicated port
 * (4517, strictPort) so a developer's own `bun alchemy dev` on 1337 is never
 * disturbed. This preserves the plan's intent: real Worker + GolemioGateway DO +
 * ClientSession DO exercised end-to-end on local workerd over HTTP + WebSocket.
 */
import { spawn, type ChildProcess } from "node:child_process"
import { createConnection } from "node:net"
import { rm, readdir } from "node:fs/promises"
import { join } from "node:path"

// Repo root is two levels up from packages/worker/test-integration.
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..")
const STAGE = "integration"
const PORT = 4517
const HOST = "127.0.0.1"
const BASE_URL = `http://${HOST}:${PORT}`
const HEALTH_URL = `${BASE_URL}/api/health`

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Resolve true if TCP `port` accepts a connection (something is listening). */
const portInUse = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const sock = createConnection({ port, host: HOST })
    const done = (v: boolean) => {
      sock.destroy()
      resolve(v)
    }
    sock.once("connect", () => done(true))
    sock.once("error", () => done(false))
    setTimeout(() => done(false), 1000)
  })

/** Wait until nothing is listening on `port`, bounded by `timeoutMs`. */
const waitForPortFree = async (port: number, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await portInUse(port))) return
    await sleep(250)
  }
}

let child: ChildProcess | undefined

export async function setup() {
  // Fail fast if our dedicated port is already taken — we never silently fall
  // back to another port (the worker is configured strictPort) and we never
  // touch 1337 where the developer's own dev server may live.
  if (await portInUse(PORT)) {
    throw new Error(
      `Integration port ${PORT} is already in use. Stop whatever is listening ` +
        `there (it is not the integration stack) and re-run.`,
    )
  }

  // detached: own process group, so teardown can signal the whole tree
  // (bun --watch -> exec.ts -> workerd) with one kill on the group.
  child = spawn("bun", ["alchemy", "dev", "--stage", STAGE], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "inherit", "inherit"],
    detached: true,
    // TABLO_STAGE must agree with --stage: alchemy.run.ts fails fast on a
    // mismatch (guard against renaming/replacing the deployed worker).
    env: { ...process.env, TABLO_DEV_PORT: String(PORT), TABLO_STAGE: STAGE },
  })

  let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined
  child.once("exit", (code, signal) => {
    exited = { code, signal }
  })

  // Poll health until 200, bounded ~60s. Bail early if the child dies.
  const deadline = Date.now() + 60_000
  let healthy = false
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(
        `bun alchemy dev exited before becoming healthy ` +
          `(code=${exited.code}, signal=${exited.signal}).`,
      )
    }
    try {
      const res = await fetch(HEALTH_URL)
      if (res.status === 200) {
        healthy = true
        break
      }
    } catch {
      // not up yet
    }
    await sleep(500)
  }
  if (!healthy) {
    await teardownProcess()
    throw new Error(`worker did not become healthy at ${HEALTH_URL} within 60s`)
  }

  // Hand the base URL to the tests.
  process.env.TABLO_INTEGRATION_URL = BASE_URL
}

async function teardownProcess() {
  if (child && child.pid !== undefined && child.exitCode === null) {
    try {
      // Negative pid → signal the whole process group (detached).
      process.kill(-child.pid, "SIGTERM")
    } catch {
      // already gone
    }
    // Give it a moment to shut workerd down, then force-kill the group.
    await sleep(2000)
    if (child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGKILL")
      } catch {
        // already gone
      }
    }
  }
  await waitForPortFree(PORT, 15_000)
}

export async function teardown() {
  await teardownProcess()

  // Remove only the integration-stage local state this run created. We verify
  // each path is integration-scoped before removing and never touch dev stages.
  const dotAlchemy = join(REPO_ROOT, ".alchemy")

  // 1) State dir for the integration stage: .alchemy/state/tablo/integration
  await rm(join(dotAlchemy, "state", "tablo", STAGE), {
    recursive: true,
    force: true,
  })

  // 2) Local DO storage dirs. Their names embed the stage
  //    (e.g. tablo-server-integration-<hash>-<DOName>). Glob by the
  //    "-integration-" marker so we never match dev-stage dirs.
  const localDir = join(dotAlchemy, "local")
  try {
    const entries = await readdir(localDir)
    for (const name of entries) {
      if (name.includes(`-${STAGE}-`) || name.includes(`-${STAGE}`)) {
        // Guard: must look like our integration stack, never a dev dir.
        if (name.includes("-dev")) continue
        await rm(join(localDir, name), { recursive: true, force: true })
      }
    }
  } catch {
    // local dir may not exist; nothing to clean
  }
}
