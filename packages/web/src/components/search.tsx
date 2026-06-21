import { type CSSProperties, useEffect, useMemo, useState } from "react"
import { parseAsString, useQueryState } from "nuqs"
import { selectorKey, type StopIndexEntry, type StopSelector } from "@app/contract"
import { useDepartures } from "../hooks/useDepartures.ts"
import { useNow } from "../hooks/useNow.ts"
import type { IndexState } from "../hooks/useStopIndex.ts"
import { boardToDepartures, type DepartureVM } from "../lib/departureVM.ts"
import { haversineMetres } from "../lib/geo.ts"
import { searchStops } from "../lib/matcher.ts"
import { buildPlatformPicks, type PlatformPick } from "../lib/platforms.ts"
import { rank, type Origin } from "../lib/ranker.ts"
import { loadRecents } from "../lib/storage.ts"
import { TIER } from "../lib/tier.ts"
import { ChevronIcon, SearchIcon, StopGlyph, VehicleIcon } from "./icons.tsx"
import { Count, RouteChip } from "./primitives.tsx"

// The stop-search text, mirrored to the `?q=` search param and validated by
// nuqs (always a string, defaulting to ""). Exported so the /search route can
// feed the same parser to TanStack Router's validateSearch — one source of
// truth for the param's name and shape.
export const queryParser = parseAsString.withDefault("")

export const AddBtn = ({
  on,
  onClick,
  small,
  name,
}: {
  on: boolean
  onClick: () => void
  small?: boolean
  name: string
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={on}
    aria-label={(on ? "Remove " : "Add ") + name}
    className={[
      "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-[8px] border font-ui font-bold transition-all duration-100",
      small ? "h-[26px] w-[26px] text-[15px]" : "h-[30px] w-[30px] text-[18px]",
      on ? "border-add-ok bg-add-ok text-white" : "border-white/[0.12] bg-ctl text-ctl-ink",
    ].join(" ")}
  >
    {on ? "✓" : "+"}
  </button>
)

/** What the /search route supplies; SearchView adds the live-preview wiring. */
interface SearchBaseHooks {
  indexState: IndexState
  chosen: ReadonlySet<string>
  origin: Origin | null
  onAdd: (selector: StopSelector, name: string) => void
  onRemove: (key: string) => void
}

interface SearchHooks extends SearchBaseHooks {
  /** Node whose inline platform list is expanded (subscribed for live data). */
  expandedNode: number | null
  onExpand: (node: number | null) => void
  /** Live departures for the expanded node, once its board has arrived. */
  previewDepartures?: ReadonlyArray<DepartureVM> | undefined
}

/** Up to this many stops surface in the empty-query nearby/recents list. */
const NEARBY_LIMIT = 10

/** The closest stops to the user, nearest-first. */
const nearestStops = (
  index: ReadonlyArray<StopIndexEntry>,
  origin: Origin,
): Array<StopIndexEntry> =>
  [...index]
    .map((e) => ({ e, d: haversineMetres(origin.lat, origin.lon, e.lat, e.lon) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, NEARBY_LIMIT)
    .map(({ e }) => e)

/**
 * Distinct matching stops, closest-first when a location is known. An empty
 * query surfaces the nearest stops (or recents when no location is available).
 */
const useEntries = (
  index: ReadonlyArray<StopIndexEntry>,
  query: string,
  origin: Origin | null,
): Array<StopIndexEntry> =>
  useMemo(() => {
    if (query.trim() === "") {
      if (origin !== null) return nearestStops(index, origin)
      // Most-recent-first, mirroring the order pushRecent maintains (a node
      // can have several platform-scoped entries — keep them all, grouped).
      const recents = loadRecents()
      return recents.flatMap((n) => index.filter((e) => String(e.node) === n))
    }
    const ranked = rank(searchStops(index, query), loadRecents(), origin)
    const seen = new Set<number>()
    const out: Array<StopIndexEntry> = []
    for (const c of ranked) {
      if (!seen.has(c.entry.node)) {
        seen.add(c.entry.node)
        out.push(c.entry)
      }
    }
    return out
  }, [index, query, origin])

/** One platform row in an expanded result: its code, the next vehicle leaving
 * from it (live), and an add toggle. Countdowns are neutral-tier — search has no
 * per-platform walk time, so there's no reachability coloring here. */
function PlatformRow({
  pick,
  on,
  onToggle,
  name,
}: {
  pick: PlatformPick
  on: boolean
  onToggle: () => void
  name: string
}) {
  const d = pick.lead
  return (
    <div
      className="flex items-center gap-[9px] border-b border-white/[0.05] py-[8px] last:border-b-0"
      style={{ "--tier": TIER.neutral.color } as CSSProperties}
    >
      <span className="inline-flex h-[26px] min-w-[26px] shrink-0 items-center justify-center rounded-[8px] border border-white/[0.12] bg-ctl px-[7px] font-ui text-[12px] font-extrabold text-chip-muted">
        {pick.code}
      </span>
      {d ? (
        <>
          {pick.kind && <VehicleIcon kind={pick.kind} size={18} />}
          <RouteChip route={d.route} />
          <span className="min-w-0 flex-1 truncate font-ui text-[14px] font-semibold leading-[1.2] text-ink-dim">
            {d.headsign}
          </span>
          <Count inMinutes={d.inMinutes} atStop={d.atStop} size={20} glow={false} />
        </>
      ) : (
        <span className="min-w-0 flex-1 font-ui text-[12.5px] font-medium text-faint">
          no live departures
        </span>
      )}
      <AddBtn small on={on} onClick={onToggle} name={name} />
    </div>
  )
}

function ResultCard({
  entry,
  chosen,
  onAdd,
  onRemove,
  expandedNode,
  onExpand,
  previewDepartures,
}: { entry: StopIndexEntry } & SearchHooks) {
  const wholeSel: StopSelector = { node: entry.node, stops: entry.stops }
  const wholeKey = selectorKey(wholeSel)
  const toggle = (sel: StopSelector, name: string): void => {
    const key = selectorKey(sel)
    if (chosen.has(key)) onRemove(key)
    else onAdd(sel, name)
  }
  const multi = entry.platforms.length > 1
  // Accordion: one result expanded at a time, so exactly one node is subscribed.
  const open = expandedNode === entry.node
  // Live departures arrive once the on-demand subscription's board lands; until
  // then the rows list each platform with no countdown.
  const live = open ? previewDepartures : undefined
  const picks = useMemo(
    () => (open ? buildPlatformPicks(entry.platforms, live) : []),
    [open, entry.platforms, live],
  )
  return (
    <div className="rounded-card border border-edge bg-card px-[14px] py-[11px]">
      <div className="flex items-center gap-[11px]">
        <StopGlyph />
        <div className="min-w-0 flex-1">
          <div className="truncate font-ui text-[16px] font-bold text-ink">
            {entry.name}
            {entry.disambig && <span className="font-medium text-meta"> · {entry.disambig}</span>}
          </div>
          <div className="font-ui text-[12px] font-medium text-meta">
            {multi ? `Whole stop · ${entry.platforms.length} platforms` : "Whole stop"}
          </div>
        </div>
        {multi && (
          <button
            type="button"
            onClick={() => onExpand(open ? null : entry.node)}
            aria-expanded={open}
            aria-label={`${open ? "Hide" : "Show"} live departures for each platform of ${entry.name}`}
            className={[
              "inline-flex h-[30px] w-[30px] shrink-0 cursor-pointer items-center justify-center rounded-[8px] border transition-colors",
              open ? "border-paper bg-paper" : "border-white/[0.12] bg-ctl",
            ].join(" ")}
          >
            <ChevronIcon
              open={open}
              color={open ? "var(--color-paper-ink)" : "var(--color-icon)"}
            />
          </button>
        )}
        <AddBtn
          on={chosen.has(wholeKey)}
          onClick={() => toggle(wholeSel, entry.name)}
          name={entry.name}
        />
      </div>
      {multi && open && (
        <div className="mt-[9px] border-t border-white/[0.06] pt-[4px]">
          {picks.map((p) => {
            const sel: StopSelector = { node: entry.node, stops: [p.stop] }
            return (
              <PlatformRow
                key={p.stop}
                pick={p}
                on={chosen.has(selectorKey(sel))}
                onToggle={() => toggle(sel, `${entry.name} ${p.code}`)}
                name={`${entry.name} nást. ${p.code}`}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function Results({ query, hooks }: { query: string; hooks: SearchHooks }) {
  const { indexState } = hooks
  const stops = indexState._tag === "ready" ? indexState.stops : []
  const entries = useEntries(stops, query, hooks.origin)
  // The panel opens before the stop index has necessarily arrived — say so
  // instead of silently showing "no stops match".
  if (indexState._tag === "loading") {
    return (
      <div className="py-[20px] text-center font-ui text-[13.5px] text-faint">
        Loading the stop list…
      </div>
    )
  }
  if (indexState._tag === "failed") {
    return (
      <div className="py-[20px] text-center font-ui text-[13.5px] text-miss">
        Couldn’t load the stop list — reload to retry.
      </div>
    )
  }
  return (
    <>
      <div className="px-[2px] pt-[14px] pb-[6px] font-ui text-[11px] font-bold tracking-[0.08em] text-faint">
        {query ? "RESULTS" : hooks.origin !== null ? "NEARBY STOPS" : "RECENT"}
      </div>
      {entries.length === 0 && (
        <div className="py-[20px] text-center font-ui text-[13.5px] text-faint">
          {query ? `No stops match “${query}”.` : "Recent stops appear here."}
        </div>
      )}
      <div className="flex flex-col gap-[10px]">
        {entries.map((e) => (
          <ResultCard key={e.node} entry={e} {...hooks} />
        ))}
      </div>
    </>
  )
}

const Field = ({
  query,
  setQuery,
  onClose,
  closeLabel,
}: {
  query: string
  setQuery: (q: string) => void
  onClose: () => void
  closeLabel: string
}) => (
  <div className="flex items-center gap-[9px] rounded-[11px] border border-edge-2 bg-sunken px-[13px] py-[10px]">
    <SearchIcon color="var(--color-field-ink)" />
    <input
      autoFocus
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      placeholder="Search stops…"
      aria-label="Search stops"
      className="min-w-0 flex-1 border-none bg-transparent font-ui text-input font-medium text-ink outline-none"
    />
    <button
      type="button"
      onClick={onClose}
      className="cursor-pointer whitespace-nowrap border-none bg-transparent p-0 font-ui text-[13px] font-semibold text-field-ink"
    >
      {closeLabel}
    </button>
  </div>
)

/** Close the search once a stop is added — bulk-add is rare and lingering is annoying on mobile. */
const useCloseOnAdd = (onClose: () => void, hooks: SearchHooks): SearchHooks =>
  useMemo(
    () => ({
      ...hooks,
      onAdd: (selector, name) => {
        hooks.onAdd(selector, name)
        onClose()
      },
    }),
    [onClose, hooks],
  )

/** The stop search body: a query field over a ranked result list. Rendered as a
 * full page on the `/search` route; `onClose` navigates back to the board. */
export function SearchView({ onClose, ...base }: { onClose: () => void } & SearchBaseHooks) {
  // ?q= as the source of truth: the query survives reloads and is shareable,
  // and clears from the URL when emptied (nuqs clearOnDefault).
  const [query, setQuery] = useQueryState("q", queryParser)

  // The result whose platform list is expanded — its whole-node board is
  // subscribed on demand so each platform row can show its next departure live.
  // One result open at a time keeps this to a single extra subscription.
  const [expandedNode, setExpandedNode] = useState<number | null>(null)
  // A new query may drop the expanded result from the list; collapse so we don't
  // keep subscribing to a node that's no longer shown.
  useEffect(() => setExpandedNode(null), [query])

  const previewSelectors = useMemo<ReadonlyArray<StopSelector>>(
    () => (expandedNode === null ? [] : [{ node: expandedNode, stops: null }]),
    [expandedNode],
  )
  const { boards } = useDepartures(previewSelectors)
  const now = useNow()
  const previewDepartures = useMemo(() => {
    if (expandedNode === null) return undefined
    const board = boards.get(`${expandedNode}`)
    return board === undefined ? undefined : boardToDepartures(board, now)
  }, [expandedNode, boards, now])

  const hooks: SearchHooks = {
    ...base,
    expandedNode,
    onExpand: setExpandedNode,
    previewDepartures,
  }
  const closingHooks = useCloseOnAdd(onClose, hooks)
  return (
    <div className="flex flex-col">
      <Field query={query} setQuery={setQuery} onClose={onClose} closeLabel="Done" />
      <Results query={query} hooks={closingHooks} />
    </div>
  )
}
