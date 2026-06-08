import { useMemo, useState } from "react"
import { selectorKey } from "@app/contract"
import { countdown } from "./lib/countdown.ts"
import { searchStops, type Candidate } from "./lib/matcher.ts"
import { rank } from "./lib/ranker.ts"
import { loadRecents, loadSelection, pushRecent, saveSelection } from "./lib/storage.ts"
import type { Selection } from "./lib/url.ts"
import { useDepartures } from "./hooks/useDepartures.ts"
import { useNow } from "./hooks/useNow.ts"
import { useStopIndex } from "./hooks/useStopIndex.ts"

const KIND_ICON: Record<string, string> = {
  tram: "🚋", metro: "🚇", train: "🚆", bus: "🚌", other: "🚏",
}

export const App = () => {
  const index = useStopIndex()
  const [selection, setSelection] = useState<Array<Selection>>(loadSelection)
  const [query, setQuery] = useState("")
  const now = useNow()
  const selectors = useMemo(() => selection.map((s) => s.selector), [selection])
  const { status, boards, reason } = useDepartures(selectors)

  const results = useMemo(() => {
    if (index._tag !== "ready") return []
    const recents = loadRecents()
    const chosen = new Set(selection.map((s) => selectorKey(s.selector)))
    const candidates: Array<Candidate> =
      query.trim() === ""
        ? index.stops // empty box surfaces recents (spec 5.3)
            .filter((e) => recents.includes(String(e.node)))
            .map((entry) => ({ entry, platform: null, stops: entry.stops, score: 0 }))
        : searchStops(index.stops, query)
    return rank(candidates, recents).filter(
      (c) => !chosen.has(selectorKey({ node: c.entry.node, stops: c.stops })),
    )
  }, [index, query, selection])

  const update = (next: Array<Selection>): void => {
    setSelection(next)
    saveSelection(next)
  }

  const add = (c: Candidate): void => {
    const name = c.platform === null ? c.entry.name : `${c.entry.name} ${c.platform}`
    update([...selection, { selector: { node: c.entry.node, stops: c.stops }, name }])
    pushRecent(c.entry.node)
    setQuery("")
  }

  const remove = (key: string): void => {
    update(selection.filter((s) => selectorKey(s.selector) !== key))
  }

  return (
    <main>
      <header>
        <h1>tablo</h1>
        <span className={"status status-" + status} title={reason ?? status} />
      </header>

      <div className="search">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={index._tag === "ready" ? "Add a stop… (andel)" : "Loading stops…"}
          disabled={index._tag !== "ready"}
        />
        {results.length > 0 && (
          <ul className="results">
            {results.map((c) => (
              <li key={selectorKey({ node: c.entry.node, stops: c.stops })}>
                <button onClick={() => add(c)}>
                  {c.entry.name}
                  {c.platform !== null && <small className="platform"> · {c.platform}</small>}
                  {c.platform === null && c.entry.platforms.length > 1 && (
                    <small className="platforms">
                      {" ("}
                      {c.entry.platforms.slice(0, 4).map((p) => p.code).join(", ")}
                      {c.entry.platforms.length > 4 ? "…" : ""}
                      {")"}
                    </small>
                  )}
                  {c.entry.disambig !== null && <small> {c.entry.disambig}</small>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {index._tag === "failed" && <p className="error">Stop index failed: {index.message}</p>}
      </div>

      <div className="boards">
        {selection.map((sel) => {
          const key = selectorKey(sel.selector)
          const board = boards.get(key)
          return (
            <section className="board" key={key}>
              <h2>
                {sel.name}
                <button className="remove" onClick={() => remove(key)} aria-label="remove">×</button>
              </h2>
              {board === undefined ? (
                <p className="muted">waiting for data…</p>
              ) : (
                <ul>
                  {board.departures
                    .map((d) => ({ d, c: countdown(d, now) }))
                    .filter(({ d, c }) => !c.gone && !d.isCanceled)
                    .slice(0, 8)
                    .map(({ d, c }, i) => (
                      <li key={i} className={c.imminent ? "imminent" : ""}>
                        <span className="route">{KIND_ICON[d.kind]} {d.route}</span>
                        <span className="headsign">{d.headsign}</span>
                        <span className="eta">{c.label}</span>
                      </li>
                    ))}
                </ul>
              )}
            </section>
          )
        })}
        {selection.length === 0 && <p className="muted">Search for a stop to begin.</p>}
      </div>
    </main>
  )
}
