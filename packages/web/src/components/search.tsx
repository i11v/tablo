import { useMemo, useState } from "react"
import { selectorKey, type StopIndexEntry, type StopSelector } from "@app/contract"
import { searchStops } from "../lib/matcher.ts"
import { rank } from "../lib/ranker.ts"
import { loadRecents } from "../lib/storage.ts"
import { SearchIcon, StopGlyph } from "./icons.tsx"

export const AddBtn = ({
  on,
  onClick,
  small,
}: {
  on: boolean
  onClick: () => void
  small?: boolean
}) => (
  <span
    onClick={onClick}
    className={[
      "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-[8px] border font-ui font-bold transition-all duration-100",
      small ? "h-[26px] w-[26px] text-[15px]" : "h-[30px] w-[30px] text-[18px]",
      on ? "border-[#1f8a5b] bg-[#1f8a5b] text-white" : "border-white/[0.12] bg-[#191920] text-[#9a9aa2]",
    ].join(" ")}
  >
    {on ? "✓" : "+"}
  </span>
)

interface SearchHooks {
  index: ReadonlyArray<StopIndexEntry>
  chosen: ReadonlySet<string>
  onAdd: (selector: StopSelector, name: string) => void
  onRemove: (key: string) => void
}

/** Distinct matching stops; empty query surfaces recents. */
const useEntries = (index: ReadonlyArray<StopIndexEntry>, query: string): Array<StopIndexEntry> =>
  useMemo(() => {
    if (query.trim() === "") {
      const recents = loadRecents()
      return index.filter((e) => recents.includes(String(e.node)))
    }
    const ranked = rank(searchStops(index, query), loadRecents())
    const seen = new Set<number>()
    const out: Array<StopIndexEntry> = []
    for (const c of ranked) {
      if (!seen.has(c.entry.node)) {
        seen.add(c.entry.node)
        out.push(c.entry)
      }
    }
    return out
  }, [index, query])

function ResultCard({ entry, chosen, onAdd, onRemove }: { entry: StopIndexEntry } & SearchHooks) {
  const wholeSel: StopSelector = { node: entry.node, stops: entry.stops }
  const wholeKey = selectorKey(wholeSel)
  const toggle = (sel: StopSelector, name: string): void => {
    const key = selectorKey(sel)
    if (chosen.has(key)) onRemove(key)
    else onAdd(sel, name)
  }
  const platforms = entry.platforms.length > 1 ? entry.platforms : []
  return (
    <div className="rounded-[13px] border border-edge bg-card px-[14px] py-[11px]">
      <div className="flex items-center gap-[11px]">
        <StopGlyph />
        <div className="min-w-0 flex-1">
          <div className="truncate font-ui text-[16px] font-bold text-ink">
            {entry.name}
            {entry.disambig && <span className="font-medium text-meta"> · {entry.disambig}</span>}
          </div>
          <div className="font-ui text-[12px] font-medium text-[#76767e]">
            {entry.platforms.length > 1 ? `Whole stop · ${entry.platforms.length} platforms` : "Whole stop"}
          </div>
        </div>
        <AddBtn on={chosen.has(wholeKey)} onClick={() => toggle(wholeSel, entry.name)} />
      </div>
      {platforms.length > 0 && (
        <div className="ml-[4px] mt-[9px] border-t border-l-2 border-white/[0.06] border-l-white/[0.07] pl-[12px]">
          {platforms.map((p) => {
            const sel: StopSelector = { node: entry.node, stops: [p.stop] }
            return (
              <div key={p.stop} className="flex items-center gap-[10px] py-[8px]">
                <span className="shrink-0 whitespace-nowrap rounded-[7px] border border-white/[0.08] bg-[#191920] px-[9px] py-[3px] font-ui text-[12px] font-bold text-[#cdcbc4]">
                  nást. {p.code}
                </span>
                <span className="min-w-0 flex-1" />
                <AddBtn small on={chosen.has(selectorKey(sel))} onClick={() => toggle(sel, `${entry.name} ${p.code}`)} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Results({ query, hooks }: { query: string; hooks: SearchHooks }) {
  const entries = useEntries(hooks.index, query)
  return (
    <>
      <div className="px-[2px] pt-[14px] pb-[6px] font-ui text-[11px] font-bold tracking-[0.08em] text-[#5e5e66]">
        {query ? "RESULTS" : "NEARBY STOPS"}
      </div>
      {entries.length === 0 && (
        <div className="py-[20px] text-center font-ui text-[13.5px] text-[#5e5e66]">
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
  <div className="flex items-center gap-[9px] rounded-[11px] border border-[#2e2e36] bg-[#0c0c0f] px-[13px] py-[10px]">
    <SearchIcon color="#8a8a92" />
    <input
      autoFocus
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      placeholder="Search stops…"
      className="min-w-0 flex-1 border-none bg-transparent font-ui text-[15px] font-medium text-ink outline-none"
    />
    <span onClick={onClose} className="cursor-pointer whitespace-nowrap font-ui text-[13px] font-semibold text-[#8a8a92]">
      {closeLabel}
    </span>
  </div>
)

/** Mobile: full-screen search that replaces the board. */
export function SearchView({ onClose, ...hooks }: { onClose: () => void } & SearchHooks) {
  const [query, setQuery] = useState("")
  return (
    <div className="flex flex-col">
      <Field query={query} setQuery={setQuery} onClose={onClose} closeLabel="Done" />
      <Results query={query} hooks={hooks} />
    </div>
  )
}

/** Desktop: popover anchored under the app-bar search box. */
export function SearchPanel({ onClose, ...hooks }: { onClose: () => void } & SearchHooks) {
  const [query, setQuery] = useState("")
  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-40" />
      <div className="absolute right-0 top-[calc(100%+8px)] z-50 max-h-[560px] w-[400px] overflow-y-auto rounded-[13px] border border-[#2e2e36] bg-[#0c0c0f] p-[13px] shadow-[0_28px_70px_rgba(0,0,0,0.6)]">
        <Field query={query} setQuery={setQuery} onClose={onClose} closeLabel="Esc" />
        <Results query={query} hooks={hooks} />
      </div>
    </>
  )
}
