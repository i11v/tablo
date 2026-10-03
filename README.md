# tablo

Live Prague public-transport departures (PID, via Golemio), each scored against
your walk time — can you still catch it?

The **primary client is the native iOS app** in [`ios/`](ios/README.md). A React
PWA is the secondary, web client. Both run on the same Cloudflare Worker API at
https://tablo.run.

## Layout

| Path | What |
| --- | --- |
| `ios/` | The iOS app — SwiftUI + MapKit, XcodeGen project (not a Bun workspace package) |
| `packages/contract` | Shared Effect schemas + `HttpApi` definition — the wire contract |
| `packages/worker` | The Cloudflare Worker (Alchemy V2, Effect): HTTP API, `/api/ws` WebSocket, Durable Objects, static assets; Golemio upstream |
| `packages/web` | The React + Vite PWA |
| `scripts/` | GTFS → stop index build, PWA / WebSocket checks |
| `docs/` | [`DEPLOY.md`](docs/DEPLOY.md); dated design specs and plans under `superpowers/` |

## Run

- **iOS app** — Xcode + XcodeGen; see [`ios/README.md`](ios/README.md). Not on
  the App Store: built from source and installed with your own development
  team. Talks to production by default.
- **Backend + web** — `bun install`, then `bun run dev` (`alchemy dev`; needs
  `GOLEMIO_API_TOKEN` in `.env`). `bun run typecheck`, `bun run test`,
  `bun run build` (stop index + web app). Local-dev caveats:
  [`docs/DEPLOY.md`](docs/DEPLOY.md#local-development).
- **Deploys** — CI only, backend + web (never the iOS app); see
  [`docs/DEPLOY.md`](docs/DEPLOY.md).

Contract changes must stay compatible with the iOS app's hand-written mirror,
`ios/Tablo/API/Wire.swift`: add fields freely; don't rename, remove or retype
them.

## Live

| What | URL |
| --- | --- |
| Production (API + web) | https://tablo.run |
| PR preview | https://preview-`<N>`.tablo.run |
