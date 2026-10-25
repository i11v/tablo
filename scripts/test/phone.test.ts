import { describe, expect, it } from "vitest"
import {
  type Device,
  type Profile,
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
} from "../lib/phone.ts"

// Trimmed from `xcrun devicectl list devices --json-output` (Xcode 27.1).
const LIST = {
  info: { outcome: "success" },
  result: {
    devices: [
      {
        identifier: "B12FEFC2-F975-5F8E-9E13-09D5C49DE8D5",
        visibilityClass: "default",
        connectionProperties: {
          pairingState: "paired",
          transportType: "localNetwork",
          tunnelState: "disconnected",
        },
        deviceProperties: { name: "Thebe", bootState: "booted", developerModeStatus: "enabled" },
        hardwareProperties: {
          platform: "iOS",
          reality: "physical",
          udid: "00008120-000E612E2E00C01E",
        },
      },
      {
        identifier: "3B96CC0A-A2B3-4E7F-8EAE-48F8CA5AC3CE",
        connectionProperties: {},
        deviceProperties: { name: "iPhone 17" },
        hardwareProperties: {
          platform: "iOS",
          reality: "virtual",
          udid: "3B96CC0A-A2B3-4E7F-8EAE-48F8CA5AC3CE",
        },
      },
    ],
  },
}

const thebe: Device = {
  id: "B12FEFC2-F975-5F8E-9E13-09D5C49DE8D5",
  udid: "00008120-000E612E2E00C01E",
  name: "Thebe",
  platform: "iOS",
  paired: true,
  tunnelState: "disconnected",
  developerMode: "enabled",
  transport: "localNetwork",
}

describe("devices", () => {
  it("reads physical devices and skips simulators", () => {
    expect(parseDevices(LIST)).toEqual([thebe])
    expect(parseDevices({})).toEqual([])
  })
  it("picks the only paired iPhone, or the one asked for", () => {
    expect(pickDevice([thebe], undefined)).toBe(thebe)
    expect(pickDevice([thebe], "thebe")).toBe(thebe)
    expect(pickDevice([thebe], thebe.udid)).toBe(thebe)
    expect(pickDevice([thebe], "Io")).toMatch(/No iPhone called "Io".*known: Thebe/)
    expect(pickDevice([{ ...thebe, paired: false }], undefined)).toMatch(/No paired iPhone/)
    expect(pickDevice([thebe, { ...thebe, name: "Io" }], undefined)).toMatch(/--device/)
  })
  it("says what stops an install", () => {
    expect(deviceProblem(thebe)).toBeUndefined()
    expect(deviceProblem({ ...thebe, paired: false })).toMatch(/Trust This Computer/)
    expect(deviceProblem({ ...thebe, developerMode: "disabled" })).toMatch(
      /Privacy & Security → Developer Mode/,
    )
    expect(deviceProblem({ ...thebe, tunnelState: "unavailable" })).toMatch(/same Wi-Fi/)
  })
  it("reads the lock state", () => {
    expect(isLocked({ result: { passcodeRequired: true, unlockedSinceBoot: true } })).toBe(true)
    expect(isLocked({ result: { passcodeRequired: false } })).toBe(false)
    expect(isLocked({})).toBeUndefined()
  })
})

describe("signing", () => {
  const profile: Profile = {
    name: "iOS Team Provisioning Profile: run.tablo.app",
    appId: "Z4382A2R3Q.run.tablo.app",
    expires: new Date("2026-11-01T00:00:00Z"),
    devices: [thebe.udid],
  }
  it("matches profiles by team, bundle id and device", () => {
    expect(profileCovers(profile, "Z4382A2R3Q", "run.tablo.app", thebe.udid)).toBe(true)
    expect(
      profileCovers(
        { ...profile, appId: "Z4382A2R3Q.*" },
        "Z4382A2R3Q",
        "run.tablo.app",
        thebe.udid,
      ),
    ).toBe(true)
    expect(
      profileCovers(
        { ...profile, appId: "Z4382A2R3Q.run.*" },
        "Z4382A2R3Q",
        "run.tablo.app",
        thebe.udid,
      ),
    ).toBe(true)
    expect(profileCovers(profile, "AAAAAAAAAA", "run.tablo.app", thebe.udid)).toBe(false)
    expect(profileCovers(profile, "Z4382A2R3Q", "run.other.app", thebe.udid)).toBe(false)
    expect(
      profileCovers({ ...profile, devices: [] }, "Z4382A2R3Q", "run.tablo.app", thebe.udid),
    ).toBe(false)
  })
  it("finds the team in a certificate subject (OU, not the CN's label)", () => {
    const subject =
      "subject=UID=E6LK7EW9GC, CN=Apple Development: someone@example.com (PT6UTP666A), OU=Z4382A2R3Q, O=Someone, C=US"
    expect(teamFromSubject(subject)).toBe("Z4382A2R3Q")
    expect(teamFromSubject("subject=CN=nothing")).toBeUndefined()
  })
  it("reads DEVELOPMENT_TEAM from an xcconfig", () => {
    expect(
      teamFromXcconfig("HONEYCOMB_API_KEY = abc\nDEVELOPMENT_TEAM = Z4382A2R3Q // personal\n"),
    ).toBe("Z4382A2R3Q")
    expect(teamFromXcconfig("// DEVELOPMENT_TEAM = Z4382A2R3Q\n")).toBeUndefined()
  })
  it("tells whether Xcode has an Apple ID", () => {
    expect(xcodeHasAccount('{\n    "IDE.Identifiers.Prod" =     (\n    );\n}', true)).toBe(false)
    expect(
      xcodeHasAccount(
        '{\n    "IDE.Identifiers.Prod" =     (\n        {\n            identifier = "x@y";\n        }\n    );\n}',
        true,
      ),
    ).toBe(true)
    expect(xcodeHasAccount("does not exist", false)).toBeUndefined()
  })
})

describe("failures", () => {
  it("explains the signing failures seen on Xcode 27", () => {
    const log =
      "error: No Accounts: Add a new account in Accounts settings. (in target 'Tablo' from project 'Tablo')\n" +
      "error: No profiles for 'run.tablo.app' were found: Xcode couldn't find any iOS App Development provisioning profiles"
    expect(explainBuildFailure(log)).toMatch(/Settings → Accounts/)
    expect(explainBuildFailure("error: No profiles for 'run.tablo.app' were found")).toMatch(
      /Settings → Accounts/,
    )
    expect(explainBuildFailure("errSecInternalComponent")).toMatch(/unlock-keychain/)
    expect(explainBuildFailure("error: 'foo' is not available in iOS")).toBeUndefined()
  })
  it("explains launch failures", () => {
    const untrusted =
      "ERROR: The application could not be launched because it has an invalid code signature, inadequate entitlements " +
      "or its profile has not been explicitly trusted by the user. (com.apple.dt.CoreDeviceError error 10002.)"
    expect(explainDeviceFailure(untrusted)).toMatch(/VPN & Device Management/)
    expect(explainDeviceFailure("The device is locked.")).toMatch(/Unlock it/)
    expect(explainDeviceFailure("something new")).toBeUndefined()
  })
})
