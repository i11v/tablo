# tablo

Personal Prague public-transport departures app. The **primary client is the
native iOS app** (`ios/`, SwiftUI + MapKit); the React + Vite PWA
(`packages/web`) is a secondary web client. Both run on one Cloudflare Worker
(static assets + HTTP API + WebSocket + Durable Objects, Golemio upstream),
deployed with Alchemy V2, backend logic in Effect. Production: https://tablo.run.
Dated design docs (historical, web-era) live in `docs/superpowers/`.

## Repo layout

- `packages/contract` — shared Effect schemas + `HttpApi` definition (the wire contract)
- `packages/worker` — the Worker: HTTP API, `/api/ws`, Durable Objects, serves the web build
- `packages/web` — React + Vite PWA, client-side stop selection
- `scripts/` — GTFS → stop index build (`build:index`), PWA / WebSocket checks
- `ios/` — the iOS app; XcodeGen project, **not** a Bun workspace package
- `docs/DEPLOY.md` — CI deploys (backend + web only; never the iOS app)

## iOS app

- `cd ios && xcodegen generate`. `Tablo.xcodeproj` and `Tablo/Info.plist` are
  generated and gitignored — edit `project.yml`, never the project.
- Test: `xcodebuild -project Tablo.xcodeproj -scheme Tablo -destination 'platform=iOS Simulator,name=iPhone 17' test`.
  More in `ios/README.md`.
- The app mirrors the contract by hand in `ios/Tablo/API/Wire.swift` (no
  codegen). Changes to `packages/contract` (HTTP API, `/api/ws` protocol,
  stop-index format) must stay compatible with it: adding fields is safe;
  renaming, removing or retyping one breaks the app. Installed builds don't
  auto-update, so keep old shapes working.

<!-- effect-solutions:start -->
## Effect Best Practices

**IMPORTANT:** Always consult effect-solutions before writing Effect code.

1. Run `effect-solutions list` to see available guides
2. Run `effect-solutions show <topic>...` for relevant patterns (supports multiple topics)
3. Search `~/.local/share/effect-solutions/effect` for real implementations

Topics: quick-start, project-setup, tsconfig, basics, services-and-layers,
data-modeling, error-handling, config, testing, cli.

Never guess at Effect patterns - check the guide first.
<!-- effect-solutions:end -->

## Local Effect Source

The Effect v4 repository is cloned to `~/.local/share/effect-solutions/effect`
for reference. Use this to explore APIs, find usage examples, and understand
implementation details when the documentation isn't enough.

## Effect v4 notes for this repo

- We use **Effect v4** (stable), pinned exactly in `package.json`.
- Everything lives in the single `effect` package — there is **no `@effect/platform`** on v4:
  - HttpApi → `effect/http-api`
  - HttpClient / FetchHttpClient / HttpServer → `effect/http`
  - Schema → **top-level** `effect/Schema` (`import { Schema } from "effect"`); `effect/schema` holds only `Model`/`VariantSchema`
  - RateLimiter → `effect/persistence`
- TypeScript 6 + the language-service patch work together. TS6 quirk: running `tsc <file>` with a tsconfig present needs `--ignoreConfig`.

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <summary>`.
Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `build`, `ci`, `perf`, `style`.
Example: `feat(api): add departures endpoint`.
