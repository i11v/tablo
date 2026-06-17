import { useMemo } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useSelector } from "@tanstack/react-store"
import { selectorKey, type StopIndexEntry } from "@app/contract"
import { AddTile, AppBar, EmptyState, MobileSearchTrigger, SubBar } from "./components/chrome.tsx"
import { StopCard } from "./components/StopCard.tsx"
import { useDepartures } from "./hooks/useDepartures.ts"
import { useNow } from "./hooks/useNow.ts"
import { useStopIndex } from "./hooks/useStopIndex.ts"
import { boardToDepartures } from "./lib/departureVM.ts"
import { haversineMetres, metresToWalkMinutes } from "./lib/geo.ts"
import { platformKey, type StopVM } from "./lib/stop.ts"
import { shareSearch } from "./lib/url.ts"
import { geoStore, selectionStore } from "./store.ts"

const formatClock = (ms: number): string =>
  new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })

export const App = () => {
  const index = useStopIndex()
  const geo = useSelector(geoStore)
  const selection = useSelector(selectionStore)
  const now = useNow()
  const navigate = useNavigate()
  const openSearch = (): void => {
    // Carry the live ?s= through the navigation so the share link survives the
    // page change (the router drops search params it isn't handed).
    void navigate({ to: "/search", search: shareSearch() })
  }

  const selectors = useMemo(() => selection.map((s) => s.selector), [selection])
  const { status, boards } = useDepartures(selectors)

  const stops = index._tag === "ready" ? index.stops : []
  const byNode = useMemo(() => new Map<number, StopIndexEntry>(stops.map((e) => [e.node, e])), [stops])

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

  const clock = formatClock(now)

  return (
    <div className="flex min-h-full flex-col">
      <AppBar
        status={status}
        clock={clock}
        geo={geo}
        locationLabel={locationLabel}
        onOpenSearch={openSearch}
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
          <EmptyState onAdd={openSearch} />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] items-start gap-[16px] px-[28px] pb-[28px]">
            {cards.map(({ key, vm }) => (
              <StopCard key={key} s={vm} onClose={() => selectionStore.actions.remove(key)} />
            ))}
            <AddTile onClick={openSearch} />
          </div>
        )}
      </div>

      {/* Mobile board */}
      <div className="flex flex-1 flex-col gap-[12px] px-[14px] pt-[6px] pb-[16px] sm:hidden">
        <MobileSearchTrigger onClick={openSearch} />
        {selection.length === 0 ? (
          <div className="px-[10px] py-[30px] text-center font-ui text-[13.5px] text-faint">
            No stops yet — tap <b className="text-ctl-ink">Add a stop</b> to search.
          </div>
        ) : (
          cards.map(({ key, vm }) => <StopCard key={key} s={vm} onClose={() => selectionStore.actions.remove(key)} />)
        )}
      </div>
    </div>
  )
}
