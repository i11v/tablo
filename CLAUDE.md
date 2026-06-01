# tablo

Personal Prague public-transport departures SPA. Single Cloudflare Worker
(static assets + API + Durable Objects), deployed with Alchemy V2, backend
logic in Effect. React + Vite frontend, client-side stop selection.
See `docs/superpowers/specs/` for the design.

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

## Effect v4 (beta) notes for this repo

- We use **Effect v4** (`effect@4.0.0-beta.74`, the `beta` dist-tag) for a slimmer bundle.
- Everything lives in the single `effect` package under `effect/unstable/*` — there is **no `@effect/platform`** on v4:
  - HttpApi → `effect/unstable/httpapi`
  - HttpClient / FetchHttpClient / HttpServer → `effect/unstable/http`
  - Schema → `effect/unstable/schema` (NOT `effect/Schema`)
  - RateLimiter → `effect/unstable/persistence`
- TypeScript 6 + the language-service patch work together. TS6 quirk: running `tsc <file>` with a tsconfig present needs `--ignoreConfig`.

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <summary>`.
Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `build`, `ci`, `perf`, `style`.
Example: `feat(api): add departures endpoint`.
