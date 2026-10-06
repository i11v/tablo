import { fold, type StopIndexEntry } from "@app/contract"

export interface Candidate {
  readonly entry: StopIndexEntry
  readonly platform: string | null // null = whole stop; else platform code
  readonly stops: ReadonlyArray<number> | null // selector scope: grouped row forwards entry.stops (null = whole single-name node, or a multi-name node's id list); a per-platform row is [thatStopId]
  readonly score: number
}

interface Searchable {
  readonly entry: StopIndexEntry
  readonly platform: string | null
  readonly stops: ReadonlyArray<number> | null
  readonly norm: string
}

/** Grouped whole-stop row, plus one row per platform when the stop has several. */
const expand = (entry: StopIndexEntry): Array<Searchable> => {
  const grouped: Searchable = { entry, platform: null, stops: entry.stops, norm: entry.norm }
  if (entry.platforms.length <= 1) return [grouped]
  const perPlatform = entry.platforms.map((p) => ({
    entry,
    platform: p.code,
    stops: [p.stop],
    norm: entry.norm + " " + fold(p.code),
  }))
  return [grouped, ...perPlatform]
}

/**
 * exact prefix > word-boundary prefix > substring. Pure; instant at ~9k rows.
 * Sorting is on the searchable's norm (not entry.norm): the grouped row and its
 * platforms share one entry, so an entry-norm tiebreak could not order grouped
 * ahead of its platforms.
 *
 * `limit` caps *distinct stops*, not expanded rows. A multi-platform stop emits
 * a grouped candidate plus one per platform, all sharing its score; capping the
 * raw row list let a handful of multi-platform prefix matches consume the whole
 * budget and evict lower-tier matches of *other* stops. Concretely, searching
 * "Pavlov" filled the list with rural "Pavlov*" stops and their A/B/… platform
 * rows, dropping the word-boundary hub "I. P. Pavlova" (score 80) before it was
 * ever reached. Counting distinct nodes keeps one stop's platforms from crowding
 * other stops out — every included stop still forwards all its platform rows.
 */
export const searchStops = (
  index: ReadonlyArray<StopIndexEntry>,
  query: string,
  limit = 10,
): Array<Candidate> => {
  const q = fold(query.trim())
  if (q.length === 0) return []
  const out: Array<Searchable & { score: number }> = []
  for (const entry of index) {
    for (const s of expand(entry)) {
      let score = 0
      if (s.norm.startsWith(q)) score = 100
      else {
        const at = s.norm.indexOf(q)
        if (at > 0 && !/[a-z0-9]/.test(s.norm[at - 1])) score = 80
        else if (at > 0) score = 60
      }
      if (score > 0) out.push({ ...s, score })
    }
  }
  out.sort(
    (a, b) => b.score - a.score || a.norm.length - b.norm.length || a.norm.localeCompare(b.norm),
  )
  const nodes = new Set<number>()
  const capped: Array<Searchable & { score: number }> = []
  for (const c of out) {
    if (!nodes.has(c.entry.node)) {
      if (nodes.size >= limit) continue // this stop is past the cap; skip its rows too
      nodes.add(c.entry.node)
    }
    capped.push(c)
  }
  return capped.map(({ entry, platform, stops, score }) => ({ entry, platform, stops, score }))
}
