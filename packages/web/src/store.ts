import { Store } from "@tanstack/store"
import { Schema } from "effect"
import {
  MAX_SELECTORS,
  selectorKey,
  StopIndex,
  StopsManifest,
  type StopIndexEntry,
  type StopSelector,
} from "@app/contract"
import { loadSelection, pushRecent, saveSelection } from "./lib/storage.ts"
import type { Selection } from "./lib/url.ts"

/**
 * App state in TanStack Store: framework-agnostic, module-level singletons. No
 * provider/context — any component reads a store with `useSelector` and writes
 * via the colocated actions, and the data outlives route changes (the stop
 * index is fetched once and stays in memory as you move between pages).
 */

// ---- Stop index (was useStopIndex) ----

export type IndexState =
  | { _tag: "loading" }
  | { _tag: "ready"; stops: ReadonlyArray<StopIndexEntry> }
  | { _tag: "failed"; message: string }

export const indexStore = new Store<IndexState>({ _tag: "loading" })

let indexStarted = false
/** Fetch the stop index once (idempotent — safe under StrictMode double-invoke). */
export const startStopIndex = (): void => {
  if (indexStarted) return
  indexStarted = true
  const load = async (): Promise<void> => {
    const manifest = Schema.decodeUnknownSync(StopsManifest)(
      await (await fetch("/data/stops-manifest.json")).json(),
    )
    const index = Schema.decodeUnknownSync(StopIndex)(await (await fetch(manifest.path)).json())
    indexStore.setState(() => ({ _tag: "ready", stops: index.stops }))
  }
  load().catch((e: unknown) => indexStore.setState(() => ({ _tag: "failed", message: String(e) })))
}

// ---- Geolocation (was useGeo) ----

export type Geo =
  | { tag: "locating" }
  | { tag: "denied" } // denied, unsupported, or errored — same neutral behavior
  | { tag: "active"; lat: number; lon: number }

const geoSupported = (): boolean =>
  typeof navigator !== "undefined" && "geolocation" in navigator

export const geoStore = new Store<Geo>(geoSupported() ? { tag: "locating" } : { tag: "denied" })

let geoStarted = false
/**
 * Start the location watch once, for the app's lifetime. No teardown: this SPA's
 * root never unmounts, and a single app-long watch matches the previous hook's
 * behaviour. The guard keeps StrictMode's double-invoke from opening two watches.
 */
export const startGeoWatch = (): void => {
  if (geoStarted) return
  geoStarted = true
  if (!geoSupported()) {
    geoStore.setState(() => ({ tag: "denied" }))
    return
  }
  navigator.geolocation.watchPosition(
    (pos) =>
      geoStore.setState(() => ({ tag: "active", lat: pos.coords.latitude, lon: pos.coords.longitude })),
    () => geoStore.setState(() => ({ tag: "denied" })),
    { enableHighAccuracy: false, maximumAge: 60_000, timeout: 15_000 },
  )
}

// ---- Selection: the shared, mutable app state ----

// A type alias (not an interface) so it satisfies TanStack's `StoreActionMap`
// (Record<string, …>) constraint — interfaces lack an implicit index signature.
type SelectionActions = {
  add: (selector: StopSelector, name: string) => void
  remove: (key: string) => void
}

/** "URL ?s= wins, then localStorage" — see loadSelection. */
export const selectionStore = new Store<ReadonlyArray<Selection>, SelectionActions>(
  loadSelection(),
  ({ setState, get }) => ({
    add: (selector: StopSelector, name: string): void => {
      const prev = get()
      // The wire protocol caps Subscribe at MAX_SELECTORS; never build a
      // selection the encoder would reject.
      if (prev.length >= MAX_SELECTORS) return
      // Newest on top: the just-added stop leads the board.
      const next: ReadonlyArray<Selection> = [{ selector, name }, ...prev]
      setState(() => next)
      saveSelection(next)
      pushRecent(selector.node)
    },
    remove: (key: string): void => {
      const next = get().filter((s) => selectorKey(s.selector) !== key)
      setState(() => next)
      saveSelection(next)
    },
  }),
)
