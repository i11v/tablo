// Pure helpers for scripts/phone.ts: reading `devicectl` JSON and Xcode's
// signing state, and turning known xcodebuild / devicectl failures into the
// one thing to do about them. No I/O here, so it's testable off a Mac.

export interface Device {
  /** CoreDevice identifier, what `devicectl --device` takes. */
  readonly id: string
  /** Hardware UDID, what `xcodebuild -destination id=` takes. */
  readonly udid: string
  readonly name: string
  readonly platform: string
  readonly paired: boolean
  /** `connected` | `disconnected` | `unavailable` — `disconnected` still comes up on demand. */
  readonly tunnelState: string
  /** `enabled` | `disabled`, or `unknown` when devicectl doesn't say. */
  readonly developerMode: string
  readonly transport: string
}

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (v !== null && typeof v === "object" ? (v as Json) : {})
const str = (v: unknown): string => (typeof v === "string" ? v : "")

/** Physical devices from `xcrun devicectl list devices --json-output <file>`. */
export const parseDevices = (json: unknown): ReadonlyArray<Device> => {
  const devices = obj(obj(json)["result"])["devices"]
  if (!Array.isArray(devices)) return []
  return devices.flatMap((raw): Array<Device> => {
    const d = obj(raw)
    const hw = obj(d["hardwareProperties"])
    const dp = obj(d["deviceProperties"])
    const cp = obj(d["connectionProperties"])
    if (str(hw["reality"]) && str(hw["reality"]) !== "physical") return []
    return [
      {
        id: str(d["identifier"]),
        udid: str(hw["udid"]),
        name: str(dp["name"]),
        platform: str(hw["platform"]),
        paired: str(cp["pairingState"]) === "paired",
        tunnelState: str(cp["tunnelState"]) || "unknown",
        developerMode: str(dp["developerModeStatus"]) || "unknown",
        transport: str(cp["transportType"]),
      },
    ]
  })
}

/**
 * The device to install on: the one named or identified by `wanted`, else the
 * only paired iPhone. Returns an error message when that's ambiguous or absent.
 */
export const pickDevice = (
  devices: ReadonlyArray<Device>,
  wanted: string | undefined,
): Device | string => {
  const phones = devices.filter((d) => d.platform === "iOS")
  if (wanted) {
    const w = wanted.toLowerCase()
    const hit = phones.find(
      (d) => d.name.toLowerCase() === w || d.id.toLowerCase() === w || d.udid.toLowerCase() === w,
    )
    if (hit) return hit
    const known = phones.map((d) => d.name).join(", ") || "none"
    return `No iPhone called "${wanted}" is known to this Mac (known: ${known}). ` + PAIR_HINT
  }
  const paired = phones.filter((d) => d.paired)
  if (paired.length === 1) return paired[0]!
  if (paired.length === 0) return "No paired iPhone. " + PAIR_HINT
  return `Several paired iPhones (${paired.map((d) => d.name).join(", ")}); pick one with --device <name>.`
}

const PAIR_HINT =
  "Plug the phone into this Mac with a cable, unlock it and tap Trust This Computer; " +
  "then open Xcode → Window → Devices and Simulators once so it pairs. After that it installs over Wi-Fi too."

/** Why `device` can't take an install right now, or undefined when it can. */
export const deviceProblem = (device: Device): string | undefined => {
  if (!device.paired) return `${device.name} isn't paired with this Mac. ` + PAIR_HINT
  if (device.developerMode === "disabled")
    return (
      `Developer Mode is off on ${device.name}. On the phone: Settings → Privacy & Security → Developer Mode → on, ` +
      "restart when asked, then unlock and confirm Turn On. (The switch only shows once the phone has been connected to Xcode.)"
    )
  if (device.tunnelState === "unavailable")
    return (
      `${device.name} is paired but not reachable. Unlock it and keep it on the same Wi-Fi as this Mac, ` +
      "or plug it in with a cable, then run this again."
    )
  return undefined
}

/** A provisioning profile installed on this Mac, decoded with `security cms -D`. */
export interface Profile {
  readonly name: string
  readonly appId: string
  readonly expires: Date
  /** UDIDs the profile may install on; empty for profiles not tied to devices. */
  readonly devices: ReadonlyArray<string>
}

/** Whether `profile` signs `bundleId` for `teamId` (exact or wildcard app id) onto device `udid`. */
export const profileCovers = (
  profile: Profile,
  teamId: string,
  bundleId: string,
  udid: string,
): boolean => {
  const appId = profile.appId
  if (!appId.startsWith(teamId + ".")) return false
  if (!profile.devices.some((d) => d.toLowerCase() === udid.toLowerCase())) return false
  const pattern = appId.slice(teamId.length + 1)
  return (
    pattern === bundleId ||
    pattern === "*" ||
    (pattern.endsWith(".*") && bundleId.startsWith(pattern.slice(0, -1)))
  )
}

/** The team id in an Apple Development certificate's subject (its OU). */
export const teamFromSubject = (subject: string): string | undefined =>
  /(?:^|[,/]\s*)OU\s*=\s*([A-Z0-9]{10})\b/.exec(subject)?.[1]

/** `DEVELOPMENT_TEAM = …` from an xcconfig, ignoring `//` comments. */
export const teamFromXcconfig = (text: string): string | undefined => {
  for (const line of text.split("\n")) {
    const m = /^\s*DEVELOPMENT_TEAM\s*=\s*([A-Z0-9]{10})\s*(?:\/\/.*)?$/.exec(line)
    if (m) return m[1]
  }
  return undefined
}

/**
 * Whether Xcode has an Apple ID signed in, from
 * `defaults read com.apple.dt.Xcode DVTDeveloperAccountManagerAppleIDLists`.
 * `undefined` when the key isn't there (another Xcode might keep it elsewhere).
 */
export const xcodeHasAccount = (defaultsOutput: string, ok: boolean): boolean | undefined => {
  if (!ok) return undefined
  // `{ "IDE.Identifiers.Prod" = ( ); }` when signed out; a quoted Apple ID in the list when in.
  return /=\s*\(\s*[^\s)]/.test(defaultsOutput)
}

export const SIGN_IN =
  "Open Xcode → Settings → Accounts, press +, choose Apple Account and sign in with the Apple ID " +
  "of your Personal Team. Then run this again: the build renews the 7-day profile by itself from then on."

/** devicectl's launch error (CoreDeviceError 10002) for an untrusted or expired profile. */
export const UNTRUSTED =
  /not been explicitly trusted|untrusted developer|profile has not been trusted/i

const TRUST =
  "On the phone: Settings → General → VPN & Device Management → under Developer App, tap your Apple ID → Trust. " +
  "Then open tablo (or run this again with --launch-only)."

/** The fix for a failed `xcodebuild`, from its log, or undefined if it isn't a known one. */
export const explainBuildFailure = (log: string): string | undefined => {
  if (/No Accounts|No account for team|Add a new account in Accounts settings/i.test(log))
    return "Xcode has no Apple ID signed in, so it can't renew the signing profile. " + SIGN_IN
  if (/errSecInternalComponent|User interaction is not allowed/i.test(log))
    return (
      "codesign couldn't read the signing key because the login keychain is locked. " +
      "Run `security unlock-keychain ~/Library/Keychains/login.keychain-db` (asks for the Mac password), then run this again."
    )
  if (/is not registered|Unable to register the device|device .* hasn't been added/i.test(log))
    return "The phone isn't registered with the Personal Team yet. In Xcode, pick the phone as the run destination and press Run once."
  if (
    /No profiles for|requires a provisioning profile|Provisioning profile .* (?:has )?expired/i.test(
      log,
    )
  )
    return "There's no valid signing profile for tablo and Xcode couldn't make one. " + SIGN_IN
  if (/maximum number of apps|too many apps/i.test(log))
    return "A Personal Team can only have 3 of your own apps on a phone at once. Delete another sideloaded app from the phone and run this again."
  if (
    /Unable to find a destination matching|Failed to prepare device|device is (?:locked|unavailable|not connected)/i.test(
      log,
    )
  )
    return "Xcode can't reach the phone. Unlock it and keep it on the same Wi-Fi as this Mac, or plug it in, then run this again."
  return undefined
}

/** The fix for a failed `devicectl device install app` / `process launch`. */
export const explainDeviceFailure = (output: string): string | undefined => {
  if (UNTRUSTED.test(output))
    return (
      "The phone doesn't trust your developer certificate yet (or the installed build's 7 days are up). " +
      TRUST
    )
  if (/\block(?:ed|State)\b|passcode|device is locked/i.test(output))
    return "The phone is locked. Unlock it and run this again with --launch-only (the app is already installed)."
  if (/Developer Mode/i.test(output))
    return "Developer Mode is off. On the phone: Settings → Privacy & Security → Developer Mode → on, restart, confirm Turn On."
  if (/maximum number of|ApplicationVerificationFailed/i.test(output))
    return "The phone refused the app's signature. If it says too many apps, delete another sideloaded app; otherwise run this again so a fresh profile is made."
  if (/unavailable|not connected|Could not connect|timed out/i.test(output))
    return "Lost the connection to the phone. Unlock it and keep it on the same Wi-Fi as this Mac, or plug it in, then run this again."
  return undefined
}

/** From `devicectl device info lockState --json-output`: true when the phone wants its passcode. */
export const isLocked = (json: unknown): boolean | undefined => {
  const required = obj(obj(json)["result"])["passcodeRequired"]
  return typeof required === "boolean" ? required : undefined
}
