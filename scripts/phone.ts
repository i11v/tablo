/**
 * Build tablo and put it on your iPhone, in one go (macOS + Xcode only).
 *
 *   bun run phone                  latest origin/main → the paired iPhone
 *   bun run phone --here           this checkout as it is, uncommitted changes included
 *   bun run phone --ref <ref>      another ref; `origin/<branch>` is fetched first
 *   bun run phone --api <url>      bake another backend in (TABLO_API_BASE)
 *   bun run phone --device <name>  pick the phone when several are paired
 *   bun run phone --check          only the preflight checks
 *   bun run phone --launch-only    open the installed app (say, after unlocking)
 *
 * The default builds in a worktree of its own under ~/Library/Caches/tablo, so
 * your checkout's branch and changes are left alone, and keeps one DerivedData
 * there so rebuilds are incremental. The team comes from --team, $TABLO_TEAM_ID,
 * DEVELOPMENT_TEAM in apps/ios/Local.xcconfig, or your Apple Development
 * certificate. One-time phone and Mac setup: apps/ios/README.md#on-your-iphone.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  type Device,
  type Profile,
  SIGN_IN,
  UNTRUSTED,
  deviceProblem,
  explainBuildFailure,
  explainDeviceFailure,
  isLocked,
  parseDevices,
  pickDevice,
  profileCovers,
  teamFromSubject,
  teamFromXcconfig,
  xcodeHasAccount,
} from "./lib/phone.ts"

const BUNDLE_ID = "run.tablo.app"
const CACHE = join(homedir(), "Library/Caches/tablo")
const LOGS = join(homedir(), "Library/Logs/tablo")

// --- arguments ------------------------------------------------------------

const argv = process.argv.slice(2)
const flag = (name: string) => argv.includes(name)
const option = (name: string): string | undefined => {
  const i = argv.indexOf(name)
  if (i === -1) return undefined
  const value = argv[i + 1]
  if (!value || value.startsWith("--")) fail(`${name} needs a value.`)
  return value
}
if (flag("--help") || flag("-h")) {
  console.log(
    readFileSync(import.meta.path, "utf8")
      .split("*/")[0]!
      .replace(/^\/\*\*\n|^ \* ?/gm, "")
      .trimEnd(),
  )
  process.exit(0)
}
const here = flag("--here")
const ref = option("--ref") ?? "origin/main"
const api = option("--api")
const wantedDevice = option("--device") ?? process.env["TABLO_DEVICE"]
const checkOnly = flag("--check")
const launchOnly = flag("--launch-only")
const known = new Set([
  "--here",
  "--ref",
  "--api",
  "--device",
  "--team",
  "--check",
  "--launch-only",
])
for (const [i, a] of argv.entries()) {
  if (a.startsWith("--") && !known.has(a)) fail(`Unknown option ${a}. See bun run phone --help.`)
  if (!a.startsWith("--") && !["--ref", "--api", "--device", "--team"].includes(argv[i - 1] ?? ""))
    fail(`Unexpected argument ${a}. See bun run phone --help.`)
}

// --- output -----------------------------------------------------------------

const started = Date.now()
const elapsed = () => `${Math.round((Date.now() - started) / 1000)}s`
function step(text: string) {
  console.log(`\n▸ ${text}`)
}
function ok(text: string) {
  console.log(`  ✓ ${text}`)
}
function note(text: string) {
  console.log(`  · ${text}`)
}
function fail(text: string, detail?: string): never {
  console.error(`\n✗ ${text}`)
  if (detail) console.error(`\n${detail}`)
  process.exit(1)
}

// --- processes ----------------------------------------------------------------

interface Result {
  readonly ok: boolean
  /** stdout alone, trimmed. */
  readonly stdout: string
  /** stdout and stderr, trimmed: what to show when it failed. */
  readonly out: string
}
const run = (
  cmd: ReadonlyArray<string>,
  opts: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {},
): Result => {
  const p = Bun.spawnSync([...cmd], {
    cwd: opts.cwd ?? process.cwd(),
    env: { ...process.env, ...opts.env },
    stdout: "pipe",
    stderr: "pipe",
    ...(opts.timeoutMs ? { timeout: opts.timeoutMs } : {}),
  })
  const stdout = p.stdout.toString()
  return { ok: p.exitCode === 0, stdout: stdout.trim(), out: (stdout + p.stderr.toString()).trim() }
}
const has = (tool: string) => run(["/usr/bin/which", tool]).ok
const tail = (text: string, lines = 25) => text.split("\n").slice(-lines).join("\n")

/** `devicectl … --json-output`, parsed; undefined (with the output) when it fails. */
const devicectl = (
  args: ReadonlyArray<string>,
  timeoutMs = 60_000,
): { json?: unknown; out: string } => {
  const dir = mkdtempSync(join(tmpdir(), "tablo-phone-"))
  const file = join(dir, "out.json")
  const r = run(["xcrun", "devicectl", ...args, "--json-output", file], { timeoutMs })
  try {
    return r.ok && existsSync(file)
      ? { json: JSON.parse(readFileSync(file, "utf8")), out: r.out }
      : { out: r.out }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- the Mac ----------------------------------------------------------------

if (process.platform !== "darwin") fail("This builds an iOS app, so it needs macOS with Xcode.")
if (!run(["xcodebuild", "-version"]).ok)
  fail(
    "xcodebuild isn't working. Install Xcode, open it once to finish setup, then `sudo xcode-select -s /Applications/Xcode.app`.",
  )
if (!has("xcodegen") && !launchOnly) fail("xcodegen is missing: `brew install xcodegen`.")

const repo = resolve(import.meta.dir, "..")
const mainCheckout = (() => {
  const common = run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: repo,
  })
  return common.ok ? resolve(common.stdout, "..") : repo
})()

// --- the phone ----------------------------------------------------------------

step("Phone")
const listed = devicectl(["list", "devices"])
if (listed.json === undefined) fail("`xcrun devicectl list devices` failed.", tail(listed.out))
const picked = pickDevice(parseDevices(listed.json), wantedDevice)
if (typeof picked === "string") fail(picked)
const device: Device = picked
const problem = deviceProblem(device)
if (problem) fail(problem)
ok(
  `${device.name}: paired, Developer Mode ${device.developerMode}, ${device.transport === "wired" ? "cable" : "Wi-Fi"}`,
)

const lockedNow = () =>
  isLocked(devicectl(["device", "info", "lockState", "--device", device.id], 30_000).json)
if (lockedNow())
  note(
    `${device.name} is locked. Unlock it before the end: the install can run locked, opening the app can't.`,
  )

async function launch(): Promise<void> {
  step("Open tablo")
  if (lockedNow()) {
    note(
      `${device.name} is locked, so tablo wasn't opened. Unlock it and tap tablo (or: bun run phone --launch-only).`,
    )
    return
  }
  const open = () =>
    devicectl([
      "device",
      "process",
      "launch",
      "--device",
      device.id,
      "--terminate-existing",
      BUNDLE_ID,
    ])
  let r = open()
  // A first install from a new certificate waits for Trust on the phone; when
  // someone's at the terminal, keep trying while they tap it.
  if (r.json === undefined && UNTRUSTED.test(r.out) && process.stdout.isTTY) {
    console.log(`\n  ${explainDeviceFailure(r.out)}\n  Waiting up to 3 minutes for that…`)
    for (const deadline = Date.now() + 180_000; r.json === undefined && Date.now() < deadline; ) {
      await Bun.sleep(5_000)
      r = open()
    }
  }
  if (r.json === undefined)
    fail(
      "Installed, but the phone wouldn't open tablo.",
      explainDeviceFailure(r.out) ?? tail(r.out),
    )
  ok("tablo is open on " + device.name)
}

if (launchOnly) {
  await launch()
  process.exit(0)
}

// --- signing ------------------------------------------------------------------

step("Signing")
const team = (() => {
  const given = option("--team") ?? process.env["TABLO_TEAM_ID"]
  if (given) return given
  const local = join(mainCheckout, "apps/ios/Local.xcconfig")
  const fromLocal = existsSync(local) ? teamFromXcconfig(readFileSync(local, "utf8")) : undefined
  if (fromLocal) return fromLocal
  const teams = new Set<string>()
  const identities = run(["security", "find-identity", "-v", "-p", "codesigning"]).stdout
  for (const [, name] of identities.matchAll(/"(Apple Development: [^"]+)"/g)) {
    const pem = run(["security", "find-certificate", "-c", name!, "-p"])
    if (!pem.ok) continue
    const subject = Bun.spawnSync(["openssl", "x509", "-noout", "-subject"], {
      stdin: Buffer.from(pem.stdout),
    })
    const t = teamFromSubject(subject.stdout.toString())
    if (t) teams.add(t)
  }
  if (teams.size === 1) return [...teams][0]!
  fail(
    teams.size === 0
      ? "No Apple Development certificate on this Mac, so there's no team to sign with. " + SIGN_IN
      : `Several teams (${[...teams].join(", ")}). Pick one with --team <id>, or put DEVELOPMENT_TEAM = <id> in apps/ios/Local.xcconfig.`,
  )
})()
ok(`team ${team}`)

const profiles: Array<Profile> = []
for (const dir of [
  "Library/Developer/Xcode/UserData/Provisioning Profiles",
  "Library/MobileDevice/Provisioning Profiles",
]) {
  const path = join(homedir(), dir)
  if (!existsSync(path)) continue
  for (const file of readdirSync(path)) {
    if (!file.endsWith(".mobileprovision")) continue
    const profile = readProfile(join(path, file))
    if (profile) profiles.push(profile)
  }
}
function readProfile(file: string): Profile | undefined {
  const plist = run(["security", "cms", "-D", "-i", file])
  if (!plist.ok) return undefined
  const dir = mkdtempSync(join(tmpdir(), "tablo-profile-"))
  try {
    const p = join(dir, "p.plist")
    writeFileSync(p, plist.stdout)
    const get = (key: string, as = "raw") => run(["plutil", "-extract", key, as, "-o", "-", p])
    const devices = get("ProvisionedDevices", "json")
    return {
      name: get("Name").stdout,
      appId: get("Entitlements.application-identifier").stdout,
      expires: new Date(get("ExpirationDate").stdout),
      devices: devices.ok ? (JSON.parse(devices.stdout) as Array<string>) : [],
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
const usable = profiles
  .filter(
    (p) =>
      profileCovers(p, team, BUNDLE_ID, device.udid) &&
      p.expires.getTime() > Date.now() + 3_600_000,
  )
  .sort((a, b) => b.expires.getTime() - a.expires.getTime())[0]
const accounts = run([
  "defaults",
  "read",
  "com.apple.dt.Xcode",
  "DVTDeveloperAccountManagerAppleIDLists",
])
const signedIn = xcodeHasAccount(accounts.stdout, accounts.ok)
if (usable) ok(`profile "${usable.name}" is valid until ${usable.expires.toLocaleString()}`)
else if (signedIn === false)
  fail(
    "No valid signing profile for tablo, and Xcode has no Apple ID signed in to make one.",
    SIGN_IN,
  )
else ok("no valid profile yet; Xcode will make one during the build")
if (signedIn === false)
  note("Xcode has no Apple ID signed in, so this profile won't renew by itself. " + SIGN_IN)

if (checkOnly) {
  console.log(`\nReady to install on ${device.name}.`)
  process.exit(0)
}

// --- source -------------------------------------------------------------------

step("Source")
const source = here ? repo : join(CACHE, "phone")
if (here) {
  ok(
    `this checkout (${run(["git", "rev-parse", "--short", "HEAD"], { cwd: repo }).stdout}, working tree as is)`,
  )
} else {
  const branch = ref.startsWith("origin/") ? ref.slice("origin/".length) : undefined
  if (branch) fetch(branch)
  const sha = run(["git", "rev-parse", "--verify", `${ref}^{commit}`], { cwd: repo })
  if (!sha.ok) fail(`Unknown ref ${ref}.`)
  if (existsSync(source) && !run(["git", "rev-parse", "--git-dir"], { cwd: source }).ok)
    rmSync(source, { recursive: true, force: true }) // a stale copy of ours whose worktree entry was pruned
  run(["git", "worktree", "prune"], { cwd: repo })
  // LEFTHOOK=0: its post-checkout job only links Local.xcconfig, done below, and
  // a failing hook would fail the checkout.
  const env = { LEFTHOOK: "0" }
  const checkout = existsSync(source)
    ? run(["git", "checkout", "--force", "--detach", sha.stdout], { cwd: source, env })
    : run(["git", "worktree", "add", "--force", "--detach", source, sha.stdout], { cwd: repo, env })
  if (!checkout.ok) fail(`Couldn't check out ${ref} in ${source}.`, tail(checkout.out))
  linkLocalConfig()
  ok(`${ref} at ${run(["git", "log", "-1", "--format=%h %s", sha.stdout], { cwd: repo }).stdout}`)
}

function fetch(branch: string): void {
  // SSH can hang on a locked 1Password agent; fall back to HTTPS with gh's credentials.
  const ssh = run(["git", "fetch", "--quiet", "origin", branch], {
    cwd: repo,
    timeoutMs: 30_000,
    env: { GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=10" },
  })
  if (ssh.ok) return
  const remote = run(["git", "remote", "get-url", "origin"], { cwd: repo }).stdout
  const slug = /github\.com[:/](.+?)(?:\.git)?$/.exec(remote)?.[1]
  if (!slug || !has("gh")) fail(`git fetch origin ${branch} failed.`, tail(ssh.out))
  const https = run(
    [
      "git",
      "-c",
      "credential.helper=",
      "-c",
      "credential.helper=!gh auth git-credential",
      "fetch",
      "--quiet",
      `https://github.com/${slug}.git`,
      `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
    ],
    { cwd: repo, timeoutMs: 60_000 },
  )
  if (!https.ok)
    fail(`git fetch origin ${branch} failed over SSH and HTTPS.`, tail(ssh.out + "\n" + https.out))
  note("fetched over HTTPS (SSH didn't answer)")
}

function linkLocalConfig(): void {
  // Local.xcconfig carries the Honeycomb key (and maybe DEVELOPMENT_TEAM); it's gitignored.
  const file = "apps/ios/Local.xcconfig"
  const from = join(mainCheckout, file)
  const to = join(source, file)
  const present = (() => {
    try {
      lstatSync(to)
      return true
    } catch {
      return false
    }
  })()
  if (existsSync(from) && !present) symlinkSync(from, to)
  if (!existsSync(from)) note(`no ${file} in ${mainCheckout}, so this build sends no telemetry`)
}

// --- build ----------------------------------------------------------------------

step("Build")
const ios = join(source, "apps/ios")
const gen = run(["xcodegen", "generate", "--quiet"], { cwd: ios })
if (!gen.ok) fail("xcodegen generate failed.", tail(gen.out))
const derivedData = join(CACHE, here ? "DerivedData-here" : "DerivedData")
mkdirSync(LOGS, { recursive: true })
const log = join(LOGS, `phone-build-${new Date().toISOString().replace(/[:.]/g, "-")}.log`)
note(`log: ${log}`)
const build = Bun.spawn(
  [
    "xcodebuild",
    "-project",
    "Tablo.xcodeproj",
    "-scheme",
    "Tablo",
    "-configuration",
    "Debug",
    "-destination",
    `id=${device.udid}`,
    "-derivedDataPath",
    derivedData,
    "-allowProvisioningUpdates",
    "-allowProvisioningDeviceRegistration",
    `DEVELOPMENT_TEAM=${team}`,
    ...(api ? [`TABLO_API_BASE=${api}`] : []),
    "build",
  ],
  { cwd: ios, stdout: "pipe", stderr: "pipe" },
)
const buildLog: Array<string> = []
const writer = Bun.file(log).writer()
async function pump(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder()
  let pending = ""
  for await (const chunk of stream) {
    writer.write(chunk)
    pending += decoder.decode(chunk, { stream: true })
    const lines = pending.split("\n")
    pending = lines.pop() ?? ""
    for (const line of lines) {
      buildLog.push(line)
      if (/\berror:|^\*\* BUILD|HONEYCOMB_API_KEY is empty/.test(line))
        console.log("  " + line.trim())
    }
  }
  buildLog.push(pending)
}
await Promise.all([pump(build.stdout), pump(build.stderr)])
await writer.end()
if ((await build.exited) !== 0) {
  const text = buildLog.join("\n")
  fail(
    "The build failed.",
    (explainBuildFailure(text) ??
      tail(
        text
          .split("\n")
          .filter((l) => /error|fail/i.test(l))
          .join("\n") || text,
      )) + `\n\nFull log: ${log}`,
  )
}
const app = join(derivedData, "Build/Products/Debug-iphoneos/Tablo.app")
const embedded = readProfile(join(app, "embedded.mobileprovision"))
ok(`built in ${elapsed()}`)

// --- install ------------------------------------------------------------------

step("Install")
const installed = devicectl(["device", "install", "app", "--device", device.id, app], 300_000)
if (installed.json === undefined)
  fail(
    `Couldn't install on ${device.name}.`,
    explainDeviceFailure(installed.out) ?? tail(installed.out),
  )
ok(`installed on ${device.name}`)

await launch()

console.log(
  `\nDone in ${elapsed()}.` +
    (embedded
      ? ` This install runs until ${embedded.expires.toLocaleString()}; run bun run phone again before then.`
      : ""),
)
