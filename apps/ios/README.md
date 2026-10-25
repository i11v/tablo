# tablo for iOS

tablo's **primary client**. The React PWA in `apps/web` is the secondary,
web client on the same backend.

A native SwiftUI + MapKit build of the **Stop prototype** design
(claude.ai/design project "Map-centered stop page"): a live map of the
stop nearest you with platform pins and live vehicles, a draggable
departures sheet, journey mode for following one vehicle, and stop search
over the whole PID index.

It runs on the tablo backend (production `https://tablo.run` by default):
the stop index, the live departures WebSocket, and the trip / vehicle
endpoints. Location (when-in-use) drives walk times, reachability and the
starting stop.

Payload shapes are mirrored by hand in `Tablo/API/Wire.swift` from
`packages/contract` (no codegen). The backend deploys on its own and installed
builds don't update with it, so contract changes must stay compatible: added
fields are fine; renamed, removed or retyped ones break the app.
`TabloTests/ContractFixtures/` holds payloads generated from the backend's
schemas (`bun run contract:write` at the repo root — don't edit them by hand),
and `ContractTests` decodes each one; CI also rejects backend changes that
would break installed builds ([`docs/DEPLOY.md`](../docs/DEPLOY.md#ios-compatibility)).

## Run

```bash
brew install xcodegen   # once
cd ios
xcodegen generate       # Tablo.xcodeproj is generated, not committed
open Tablo.xcodeproj    # or build headless:
xcodebuild -project Tablo.xcodeproj -scheme Tablo -destination 'platform=iOS Simulator,name=iPhone 17' build
xcodebuild -project Tablo.xcodeproj -scheme Tablo -destination 'platform=iOS Simulator,name=iPhone 17' test
```

iOS 18+, iPhone, portrait. Follows the system appearance: the dark LED board
at night, warm paper (`tokens/light.css`) in daylight.

In the simulator, give it a Prague location and permission:

```bash
xcrun simctl location booted set 50.0817,14.4194        # Národní třída
xcrun simctl privacy booted grant location run.tablo.app
```

Not on the App Store. To install on a phone, sign with your own development
team: `project.yml` leaves `DEVELOPMENT_TEAM` empty, so pick one in Xcode
(Signing & Capabilities; lost on the next `xcodegen generate`), pass
`DEVELOPMENT_TEAM=<team id>` to `xcodebuild`, or put `DEVELOPMENT_TEAM = <team id>`
in `Local.xcconfig`. Or use `bun run phone`, below.

### On your iPhone

From the repo root on the Mac the phone is paired with:

```bash
bun run phone            # latest origin/main → your iPhone, opened when done
bun run phone --here     # this checkout as it is
bun run phone --check    # only check the Mac and the phone are ready
bun run phone --help     # --ref, --api, --device, --launch-only
```

It fetches `origin/main`, builds it in its own worktree under
`~/Library/Caches/tablo` (your checkout is left alone; DerivedData is kept
there, so rebuilds are incremental), signs it, installs it with `devicectl` and
opens it. Before building it checks the phone (paired, reachable, Developer
Mode) and signing (a valid profile, or an Apple ID in Xcode to make one), and
each known failure ends with the one thing to do about it. The build log goes to
`~/Library/Logs/tablo/`. It takes the team from your Apple Development
certificate when there's only one.

A free Personal Team build stops opening after **7 days**: run it again. It
renews the profile by itself as long as Xcode has your Apple ID.

**Once per Mac**

1. Xcode → Settings → Accounts → + → Apple Account, and sign in. Without this
   the build fails with "No Accounts" once the 7-day profile is gone. Xcode can
   drop the account (after a macOS or Xcode update, say); `bun run phone --check`
   tells you.
2. `brew install xcodegen`.

**Once per phone** (nothing on the phone prompts for these; you go looking):

1. Plug it in with a cable, unlock it, tap **Trust This Computer**, and open
   Xcode → Window → Devices and Simulators once so it pairs. From then on it
   installs over Wi-Fi too.
2. **Developer Mode**: Settings → Privacy & Security → Developer Mode → on,
   restart, then confirm Turn On. The switch only appears after the phone has
   been connected to Xcode.
3. After the first install (and again if the signing certificate changes),
   tablo won't open until you trust it: Settings → General → VPN & Device
   Management → under Developer App, your Apple ID → **Trust**. When you run the
   script in a terminal, it waits for you to tap it and then opens the app.

For a Wi-Fi install the phone has to be awake on the same network as the Mac;
it installs while locked, but opening the app needs it unlocked
(`bun run phone --launch-only` once it is).

CI (`.github/workflows/ios.yml`) runs `xcodegen generate` + `xcodebuild build-for-testing`/`test-without-building`
(Swift packages and DerivedData cached, simulator booting during the build)
on PRs and pushes that touch `apps/ios/`. The production deploy doesn't build the
app ([`docs/DEPLOY.md`](../docs/DEPLOY.md)).

### Pointing at another backend

The API base defaults to production. Pass a launch argument (Xcode: scheme →
Run → Arguments, or `simctl launch … -TabloAPIBase …`) to use a local dev
server; the WebSocket follows the base (`http` → `ws`, `https` → `wss`), and
ATS allows local networking:

```bash
xcrun simctl launch booted run.tablo.app -TabloAPIBase http://localhost:1337
```

A launch argument only lasts for that launch. To bake a backend into a build
(say, a PR preview on a phone), set the `TABLO_API_BASE` build setting:

```bash
xcodebuild -project Tablo.xcodeproj -scheme Tablo -destination 'platform=iOS,name=<phone>' TABLO_API_BASE=https://preview-32.tablo.run -allowProvisioningUpdates build
```

### Tracing

The app traces itself with OpenTelemetry and sends spans to Honeycomb (service
`tablo-ios`) when it has an **ingest key**. Without one it sends nothing. Put
the key in `Local.xcconfig` (gitignored), next to `Tablo.xcconfig`:

```
HONEYCOMB_API_KEY = <ingest key>
```

Or pass it per build (`xcodebuild … HONEYCOMB_API_KEY=<key>`) or per launch
(`-HoneycombAPIKey <key>`). A git worktree gets the main checkout's
`Local.xcconfig` symlinked in when it's created (a lefthook `post-checkout`
job); for a worktree made before that, run `scripts/link-local-config.sh` in
it. A build without a key says so with a build warning. The key ships inside the app, so use an ingest
key, which can only send data. Spans go to the EU region
(`HONEYCOMB_API_HOST = api.eu1.honeycomb.io` in `Tablo.xcconfig`); a US
account sets `api.honeycomb.io` there.

Each launch and each return to the foreground gets its own trace, `app.launch`
or `app.resume`. The trace stays open until the stop page has settled: its
board, its vehicles and their trip plans are all in, or 30 s pass. It nests
`index.load`, `location.first_fix`, `feed.board`, `vehicles.poll` and
`plans.load`, and the HTTP requests under each one. Each request span carries
URLSession's DNS / connect / TLS / TTFB breakdown and a `traceparent` header.
The root span's `tablo.vehicles_ms`, `tablo.board_ms`, `tablo.plans_ms`,
`tablo.outcome` and `tablo.missing` attributes are the ones to graph. Every span
carries the SDK's `session.id`. To watch spans locally without a key, print
them to the console:

```bash
xcrun simctl launch --console-pty booted run.tablo.app -TabloTraceConsole YES
```

## Layout

| Path | What |
| --- | --- |
| `Tablo/API` | `Wire` (every payload's shape — field names live only here), `TabloAPI` (REST + on-disk stop-index cache), `DeparturesFeed` (the WebSocket: subscribe, backoff, resubscribe) |
| `Tablo/Location` | `LocationService`, when-in-use CoreLocation |
| `Tablo/Domain` | Models, `Board` (departure view-model), `StopSearch` (matcher + ranker), `JourneyBuilder` (trip anchoring, your stop, the vehicle's segment), `Geo` |
| `Tablo/Map` | `StopMapController`, a port of `map-proto.js` on `MKMapView`, plus marker art and the journey overlay |
| `Tablo/Stop` | `StopModel` (screen state, polling, lifecycle) and the SwiftUI screen, sheet and search |
| `Tablo/Telemetry` | OpenTelemetry setup (Honeycomb or console) and `PhaseTrace`, the launch / resume trace |
| `Tablo/Theme`, `Tablo/DesignSystem` | Design-system tokens, fonts and components |

## Behaviour

- **Starting stop.** The first location fix picks the nearest stop (within
  5 km); otherwise the last stop you looked at, else Národní třída. Once you
  pick a stop yourself, location never moves you again that session.
- **Board.** Ports the web's `departureVM`: canceled and departed (> 30 s)
  rows drop, countdowns floor to whole minutes on a 1 Hz clock, the lead is the
  first departure you can still catch. Without a location the board goes
  neutral (no verdict pill, no urgency colour).
- **Live data.** The socket pauses in the background and resubscribes on
  every connect. Vehicles around the stop are polled every 10 s and glide
  between fixes; the followed trip's vehicle is polled every 10 s and glides
  along the trip's shape. Missing endpoints just mean no vehicles / no journey.
- **Stop index.** Content-hashed, cached on disk under its path; offline, the
  newest cached copy serves.

## Differences from the web prototype

- **Map.** Apple Maps (muted, with a warm scrim, following light/dark) stands in for
  MapLibre + OpenFreeMap. Zoom levels keep MapLibre's 512px-tile scale, so
  the prototype's zoom numbers carry over. Apple's Legal label sits above the sheet.
- **Every stop is home.** The prototype framed searched stops off-centre with
  a separate pin; here any stop gets the home framing, its platform pins and
  its vehicles. A stop whose platforms have no coordinates shows a name pin.
- **Focusing a journey stop** centres it in the map left visible above the
  sheet. The prototype centred it in the full view, which put it under the sheet.
- Hover states became press states. The status bar is the real one.

Fonts: Hanken Grotesk (OFL, `Resources/Fonts/OFL-HankenGrotesk.txt`) and Doto (OFL), both from Google Fonts.
