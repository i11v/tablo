import { Cause, Clock, Deferred, Effect, Ref } from "effect"
import { reasonOf } from "./upstream.ts"

/** What upstream definitively said about a key. Cached. */
export type Found<A> = { readonly _tag: "ok"; readonly value: A } | { readonly _tag: "notFound" }

/**
 * Result of a gateway lookup. Plain data on purpose: it crosses the Durable
 * Object RPC boundary, where typed failures don't survive intact, so the
 * gateway never fails and HTTP handlers map this to status codes.
 */
export type Outcome<A> = Found<A> | { readonly _tag: "unavailable"; readonly reason: string }

export interface CacheOptions {
  /** Entries younger than this are served without asking upstream. */
  readonly ttlMs: number
  /** TTL for a cached notFound (defaults to ttlMs). */
  readonly notFoundTtlMs?: number
  /** On upstream failure, entries younger than this are served instead. */
  readonly maxStaleMs: number
  /** Bound on entries; the least recently stored are evicted first. */
  readonly capacity: number
}

interface Entry<A> {
  readonly found: Found<A>
  readonly fetchedAt: number
}

/**
 * Single-key read-through cache in the board cache's discipline: per-key TTL,
 * bounded capacity, one in-flight upstream call per key shared by every
 * concurrent caller, and a stale fallback when upstream fails. Keys derive
 * from client input, so the bound is what keeps it from being an OOM vector.
 */
export const makeOutcomeCache = <A>(options: CacheOptions) =>
  Effect.gen(function* () {
    const entries = yield* Ref.make(new Map<string, Entry<A>>())
    const inflight = yield* Ref.make(new Map<string, Deferred.Deferred<Outcome<A>>>())
    const notFoundTtlMs = options.notFoundTtlMs ?? options.ttlMs

    const store = (key: string, found: Found<A>, fetchedAt: number) =>
      Ref.update(entries, (m) => {
        const next = new Map(m)
        next.delete(key) // re-insert so iteration order tracks recency
        next.set(key, { found, fetchedAt })
        while (next.size > options.capacity) {
          next.delete(next.keys().next().value as string)
        }
        return next
      })

    /** Stale-if-error: the last definitive answer, if recent enough. */
    const fallback = (key: string, reason: string) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const stale = (yield* Ref.get(entries)).get(key)
        return stale !== undefined && now - stale.fetchedAt < options.maxStaleMs
          ? (stale.found as Outcome<A>)
          : ({ _tag: "unavailable", reason } as const)
      })

    /** Fetch `key` and settle its Deferred. Always settles and releases the
     * in-flight slot — including on defect or interruption — so waiters on
     * other fibers can never hang. */
    const fetchInto = <E>(
      key: string,
      fetch: Effect.Effect<Found<A>, E>,
      deferred: Deferred.Deferred<Outcome<A>>,
    ) =>
      fetch.pipe(
        Effect.flatMap((found) =>
          Effect.gen(function* () {
            yield* store(key, found, yield* Clock.currentTimeMillis)
            yield* Deferred.succeed(deferred, found)
          }),
        ),
        Effect.catchCause((cause) =>
          Effect.flatMap(fallback(key, reasonOf(Cause.squash(cause))), (outcome) =>
            Deferred.succeed(deferred, outcome),
          ),
        ),
        // Completing an already-done Deferred is a no-op.
        Effect.onExit(() =>
          Effect.gen(function* () {
            yield* Deferred.succeed(deferred, yield* fallback(key, "Interrupted"))
            yield* Ref.update(inflight, (m) => {
              if (m.get(key) !== deferred) return m
              const next = new Map(m)
              next.delete(key)
              return next
            })
          }),
        ),
      )

    /** Never fails: a fresh hit, the shared in-flight result, or a new fetch. */
    const get = <E>(key: string, fetch: Effect.Effect<Found<A>, E>): Effect.Effect<Outcome<A>> =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const entry = (yield* Ref.get(entries)).get(key)
        if (entry !== undefined) {
          const ttl = entry.found._tag === "ok" ? options.ttlMs : notFoundTtlMs
          if (now - entry.fetchedAt < ttl) return entry.found
        }
        const mine = yield* Deferred.make<Outcome<A>>()
        // Atomic claim: exactly one caller per key fetches, the rest await it.
        const existing = yield* Ref.modify(inflight, (m) => {
          const current = m.get(key)
          if (current !== undefined) return [current, m] as const
          const next = new Map(m)
          next.set(key, mine)
          return [undefined, next] as const
        })
        if (existing !== undefined) return yield* Deferred.await(existing)
        yield* fetchInto(key, fetch, mine)
        return yield* Deferred.await(mine)
      })

    return { get }
  })
