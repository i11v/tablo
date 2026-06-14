import { type ReactNode, useEffect, useMemo, useState } from "react"
import { MAX_SELECTORS, selectorKey, type StopIndexEntry, type StopSelector } from "@app/contract"
import { AddTile, AppBar, EmptyState, MobileSearchTrigger, SubBar } from "./components/chrome.tsx"
import { SearchPanel, SearchView } from "./components/search.tsx"
import { StopCard } from "./components/StopCard.tsx"
import { useDepartures } from "./hooks/useDepartures.ts"
import { useGeo } from "./hooks/useGeo.ts"
import { useNow } from "./hooks/useNow.ts"
import { useStopIndex } from "./hooks/useStopIndex.ts"
import { boardToDepartures } from "./lib/departureVM.ts"
import { haversineMetres, metresToWalkMinutes } from "./lib/geo.ts"
import { platformKey, type StopVM } from "./lib/stop.ts"
import { loadSelection, pushRecent, saveSelection } from "./lib/storage.ts"
import type { Selection } from "./lib/url.ts"

const formatClock = (ms: number): string =>
  new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })

export const App = () => {
  const index = useStopIndex()
  const now = useNow()
  const geo = useGeo()
  const [selection, setSelection] = useState<Array<Selection>>(loadSelection)
  const [searching, setSearching] = useState(false)
  // The search result whose platform picker is expanded — subscribed on demand
  // so the inline picker shows the same live data the stop card does.
  const [previewNode, setPreviewNode] = useState<number | null>(null)

  const selectors = useMemo(() => selection.map((s) => s.selector), [selection])
  const chosen = useMemo(() => new Set(selection.map((s) => selectorKey(s.selector))), [selection])
  // Whole-node selector for the expanded search result, unless it's already
  // subscribed (reuse its board) or the subscription is at the wire cap.
  const previewSel = useMemo<StopSelector | null>(() => {
    if (previewNode === null || chosen.has(`${previewNode}`)) return null
    return { node: previewNode, stops: null }
  }, [previewNode, chosen])
  const allSelectors = useMemo(
    () => (previewSel !== null && selectors.length < MAX_SELECTORS ? [...selectors, previewSel] : selectors),
    [selectors, previewSel],
  )
  const { status, boards } = useDepartures(allSelectors)
  // Live departures for the expanded result's node (from its own subscription or
  // an existing whole-node one); undefined until the first board arrives.
  const previewDepartures = useMemo(() => {
    if (previewNode === null) return undefined
    const board = boards.get(`${previewNode}`)
    return board === undefined ? undefined : boardToDepartures(board, now)
  }, [previewNode, boards, now])

  const stops = index._tag === "ready" ? index.stops : []
  const byNode = useMemo(() => new Map<number, StopIndexEntry>(stops.map((e) => [e.node, e])), [stops])

  // close the desktop search popover on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setSearching(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // Drop the on-demand preview subscription whenever search closes.
  useEffect(() => {
    if (!searching) setPreviewNode(null)
  }, [searching])

  const update = (next: Array<Selection>): void => {
    setSelection(next)
    saveSelection(next)
  }
  const add = (selector: StopSelector, name: string): void => {
    // The wire protocol caps Subscribe at MAX_SELECTORS; never build a
    // selection the encoder would reject.
    if (selection.length >= MAX_SELECTORS) return
    // Newest on top: the just-added stop/platform is what the user is looking
    // for, so it leads the board rather than landing at the bottom.
    update([{ selector, name }, ...selection])
    pushRecent(selector.node)
  }
  const remove = (key: string): void => {
    update(selection.filter((s) => selectorKey(s.selector) !== key))
  }
  // Re-scope a card in place (preserve board order) when a platform is picked on
  // its map, or it's reset to the whole stop.
  const replaceAt = (index: number, selector: StopSelector, name: string): void => {
    update(selection.map((sel, i) => (i === index ? { selector, name } : sel)))
    pushRecent(selector.node)
  }

  const walkOf = (node: number): number | null => {
    if (geo.tag !== "active") return null
    const e = byNode.get(node)
    if (e === undefined) return null
    return metresToWalkMinutes(haversineMetres(geo.lat, geo.lon, e.lat, e.lon))
  }

  const locationLabel = useMemo(() => {
    if (geo.tag !== "active" || stops.length === 0) return null
    let best: string | null = null
    let bestD = Infinity
    for (const e of stops) {
      const d = haversineMetres(geo.lat, geo.lon, e.lat, e.lon)
      if (d < bestD) {
        bestD = d
        best = e.name
      }
    }
    return best
  }, [geo, stops])

  // Assemble a StopVM per selection from its live board.
  const cards = selection.map((sel) => {
    const key = selectorKey(sel.selector)
    const board = boards.get(key)
    const node = sel.selector.node
    const departures = board === undefined ? [] : boardToDepartures(board, now)
    const e = byNode.get(node)

    // A platform-scoped selection → show a pin badge when the code is present.
    let pin: string | null = null
    let name = sel.name
    if (sel.selector.stops !== null && e !== undefined) {
      const code = e.platforms.find((p) => sel.selector.stops!.includes(p.stop))?.code ?? null
      if (code !== null && departures.some((d) => platformKey(d) === code)) {
        pin = code
        name = e.name
      }
    }

    const vm: StopVM = { node, name, walkMinutes: walkOf(node), pin, departures }
    return { key, vm }
  })

  // Stable reference between renders (geo only changes on a new fix), so the
  // search panel's nearby sort doesn't rerun on every clock tick.
  const origin = useMemo(
    () => (geo.tag === "active" ? { lat: geo.lat, lon: geo.lon } : null),
    [geo],
  )
  const searchHooks = {
    indexState: index,
    chosen,
    origin,
    onAdd: add,
    onRemove: remove,
    expandedNode: previewNode,
    onExpand: setPreviewNode,
    previewDepartures,
  }
  const clock = formatClock(now)

  const renderCard = ({ key, vm }: { key: string; vm: StopVM }, i: number): ReactNode => {
    const e = byNode.get(vm.node)
    return (
      <StopCard
        key={key}
        s={vm}
        onClose={() => remove(key)}
        platforms={e?.platforms}
        origin={origin}
        onPick={(stop) => {
          const code = e?.platforms.find((p) => p.stop === stop)?.code
          replaceAt(i, { node: vm.node, stops: [stop] }, code ? `${e!.name} ${code}` : vm.name)
        }}
        onWholeStop={() => replaceAt(i, { node: vm.node, stops: null }, e?.name ?? vm.name)}
      />
    )
  }

  return (
    <div className="flex min-h-full flex-col">
      <AppBar
        status={status}
        clock={clock}
        geo={geo}
        locationLabel={locationLabel}
        searchOpen={searching}
        onOpenSearch={() => setSearching(true)}
        searchPanel={<SearchPanel onClose={() => setSearching(false)} {...searchHooks} />}
      />
      <SubBar status={status} count={selection.length} />

      {index._tag === "failed" && (
        <div className="px-[16px] font-ui text-[13px] text-miss sm:px-[28px]">
          Couldn’t load the stop list: {index.message}
        </div>
      )}

      {/* Desktop board */}
      <div className="hidden flex-1 sm:block">
        {selection.length === 0 ? (
          <EmptyState onAdd={() => setSearching(true)} />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] items-start gap-[16px] px-[28px] pb-[28px]">
            {cards.map(renderCard)}
            <AddTile onClick={() => setSearching(true)} />
          </div>
        )}
      </div>

      {/* Mobile board */}
      <div className="flex flex-1 flex-col gap-[12px] px-[14px] pt-[6px] pb-[16px] sm:hidden">
        {searching ? (
          <SearchView onClose={() => setSearching(false)} {...searchHooks} />
        ) : (
          <>
            <MobileSearchTrigger onClick={() => setSearching(true)} />
            {selection.length === 0 ? (
              <div className="px-[10px] py-[30px] text-center font-ui text-[13.5px] text-faint">
                No stops yet — tap <b className="text-ctl-ink">Add a stop</b> to search.
              </div>
            ) : (
              cards.map(renderCard)
            )}
          </>
        )}
      </div>
    </div>
  )
}
