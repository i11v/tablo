import { Trip } from "@app/contract"
import { Clock, Effect, Layer, Option, Schema } from "effect"
import * as Context from "effect/Context"
import type { Entry, PersistentTier } from "./cache.ts"

/** The slice of a Durable Object's `storage.sql` this store uses. */
export interface SqlExec {
  exec(
    query: string,
    ...bindings: Array<string | number>
  ): { toArray(): Array<Record<string, unknown>> }
}

export interface TripStoreOptions {
  /** Rows older than this are deleted (and never served). */
  readonly maxAgeMs: number
  /** Bound on rows; the oldest fetched are deleted first. */
  readonly capacity: number
}

/** A SQL call on the trip table threw. Logged, never surfaced. */
class TripStoreError extends Schema.TaggedError<TripStoreError>()("TripStoreError", {
  cause: Schema.Defect(),
}) {}

const decodeTrip = Schema.decodeUnknownOption(Schema.fromJsonString(Trip))

/**
 * Trip plans that outlive the gateway Durable Object's memory. Only found
 * plans are stored: a notFound is cheap to forget and keyed by client input.
 */
export class TripStore extends Context.Service<TripStore, PersistentTier<Trip>>()(
  "@app/TripStore",
) {
  /** No persistence: every cold start refetches. */
  static readonly layerNone = Layer.succeed(TripStore, {
    load: () => Effect.undefined,
    save: () => Effect.void,
  })

  /**
   * A table in the DO's SQLite storage. SQL calls are synchronous; any that
   * throws (quota, corruption) is logged and treated as a miss.
   */
  static readonly layerSql = (sql: SqlExec, options: TripStoreOptions) =>
    Layer.effect(
      TripStore,
      Effect.gen(function* () {
        const run = (what: string, query: string, ...bindings: Array<string | number>) =>
          Effect.try({
            try: () => sql.exec(query, ...bindings).toArray(),
            catch: (cause) => new TripStoreError({ cause }),
          }).pipe(
            Effect.tapError((cause) => Effect.logWarning(`TripStore ${what} failed`, cause)),
            Effect.orElseSucceed(() => []),
          )

        const prune = Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          yield* run("prune", "DELETE FROM trip_plans WHERE fetched_at < ?", now - options.maxAgeMs)
          yield* run(
            "prune",
            `DELETE FROM trip_plans WHERE id IN
               (SELECT id FROM trip_plans ORDER BY fetched_at DESC LIMIT -1 OFFSET ?)`,
            options.capacity,
          )
        })

        yield* run(
          "init",
          `CREATE TABLE IF NOT EXISTS trip_plans (
             id TEXT PRIMARY KEY,
             fetched_at INTEGER NOT NULL,
             body TEXT NOT NULL
           )`,
        )
        yield* run(
          "init",
          "CREATE INDEX IF NOT EXISTS trip_plans_fetched_at ON trip_plans (fetched_at)",
        )
        yield* prune

        const load = (tripId: string) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis
            const [row] = yield* run(
              "load",
              "SELECT fetched_at, body FROM trip_plans WHERE id = ? AND fetched_at >= ?",
              tripId,
              now - options.maxAgeMs,
            )
            if (row === undefined) return undefined
            // Rows written by an older Trip shape fail to decode: refetch them.
            return decodeTrip(row.body).pipe(
              Option.map(
                (value): Entry<Trip> => ({
                  found: { _tag: "ok", value },
                  fetchedAt: Number(row.fetched_at),
                }),
              ),
              Option.getOrUndefined,
            )
          })

        const save = (tripId: string, { found, fetchedAt }: Entry<Trip>) =>
          found._tag === "ok"
            ? Effect.gen(function* () {
                yield* run(
                  "save",
                  "INSERT OR REPLACE INTO trip_plans (id, fetched_at, body) VALUES (?, ?, ?)",
                  tripId,
                  fetchedAt,
                  JSON.stringify(found.value),
                )
                yield* prune
              })
            : Effect.void

        return { load, save }
      }),
    )
}
