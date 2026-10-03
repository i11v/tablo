# tablo for iOS

A native SwiftUI + MapKit build of the **Stop prototype** design
(claude.ai/design project "Map-centered stop page"): a live map of the
stop nearest you with platform pins and live vehicles, a draggable
departures sheet, journey mode for following one vehicle, and stop search
over the whole PID index.

It runs on the tablo backend (production `https://tablo.run` by default):
the stop index, the live departures WebSocket, and the trip / vehicle
endpoints. Location (when-in-use) drives walk times, reachability and the
starting stop.

## Run

```bash
brew install xcodegen   # once
cd ios
xcodegen generate       # Tablo.xcodeproj is generated, not committed
open Tablo.xcodeproj    # or build headless:
xcodebuild -project Tablo.xcodeproj -scheme Tablo -destination 'platform=iOS Simulator,name=iPhone 17' build
xcodebuild -project Tablo.xcodeproj -scheme Tablo -destination 'platform=iOS Simulator,name=iPhone 17' test
```

iOS 18+, iPhone, portrait, dark only.

In the simulator, give it a Prague location and permission:

```bash
xcrun simctl location booted set 50.0817,14.4194        # Národní třída
xcrun simctl privacy booted grant location run.tablo.app
```

### Pointing at another backend

The API base defaults to production. Pass a launch argument (Xcode: scheme →
Run → Arguments, or `simctl launch … -TabloAPIBase …`) to use a local dev
server; the WebSocket follows the base (`http` → `ws`, `https` → `wss`), and
ATS allows local networking:

```bash
xcrun simctl launch booted run.tablo.app -TabloAPIBase http://localhost:1337
```

## Layout

| Path | What |
| --- | --- |
| `Tablo/API` | `Wire` (every payload's shape — field names live only here), `TabloAPI` (REST + on-disk stop-index cache), `DeparturesFeed` (the WebSocket: subscribe, backoff, resubscribe) |
| `Tablo/Location` | `LocationService`, when-in-use CoreLocation |
| `Tablo/Domain` | Models, `Board` (departure view-model), `StopSearch` (matcher + ranker), `JourneyBuilder` (trip anchoring, your stop, the vehicle's segment), `Geo` |
| `Tablo/Map` | `StopMapController`, a port of `map-proto.js` on `MKMapView`, plus marker art and the journey overlay |
| `Tablo/Stop` | `StopModel` (screen state, polling, lifecycle) and the SwiftUI screen, sheet and search |
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

- **Map.** Apple Maps (dark, muted, with a warm scrim) stands in for
  MapLibre + OpenFreeMap. Zoom levels keep MapLibre's 512px-tile scale, so
  the prototype's zoom numbers carry over. Apple's Legal label sits above the sheet.
- **Every stop is home.** The prototype framed searched stops off-centre with
  a separate pin; here any stop gets the home framing, its platform pins and
  its vehicles. A stop whose platforms have no coordinates shows a name pin.
- **Focusing a journey stop** centres it in the map left visible above the
  sheet. The prototype centred it in the full view, which put it under the sheet.
- Hover states became press states. The status bar is the real one.

Fonts: Hanken Grotesk (OFL, `Resources/Fonts/OFL-HankenGrotesk.txt`) and Doto (OFL), both from Google Fonts.
