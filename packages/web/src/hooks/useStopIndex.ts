import { queryOptions, useQuery } from "@tanstack/react-query"
import { Schema } from "effect"
import { StopIndex, StopsManifest, type StopIndexEntry } from "@app/contract"

export type IndexState =
  | { _tag: "loading" }
  | { _tag: "ready"; stops: ReadonlyArray<StopIndexEntry> }
  | { _tag: "failed"; message: string }

// IndexSource (spec §5.5): v1 loads the bundled, content-hashed index artifact.
// The path is inlined at build time (vite.config.ts `define`) so this is a single
// request; it falls back to the runtime manifest lookup when the constant is null
// (dev before build:index, where the manifest is fetched then read for its path).
const fetchStopIndex = async (): Promise<ReadonlyArray<StopIndexEntry>> => {
  const path =
    __STOP_INDEX_PATH__ ??
    Schema.decodeUnknownSync(StopsManifest)(
      await (await fetch("/data/stops-manifest.json")).json(),
    ).path
  const index = Schema.decodeUnknownSync(StopIndex)(await (await fetch(path)).json())
  return index.stops
}

export const stopIndexQueryOptions = queryOptions({
  queryKey: ["stop-index"],
  queryFn: fetchStopIndex,
  // The index is content-hashed and immutable for the session, so fetch it once
  // and never refetch — the service worker handles cross-session revalidation.
  // A shared QueryClient also dedupes the board and /search to a single request.
  staleTime: Infinity,
  gcTime: Infinity,
})

/** The stop index as the loading/ready/failed shape the UI switches on. */
export const useStopIndex = (): IndexState => {
  const query = useQuery(stopIndexQueryOptions)
  if (query.isPending) return { _tag: "loading" }
  if (query.isError) return { _tag: "failed", message: String(query.error) }
  return { _tag: "ready", stops: query.data }
}
