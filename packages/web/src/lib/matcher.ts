import { fold, type StopIndexEntry } from "@app/contract"

export interface Candidate {
  readonly entry: StopIndexEntry
  readonly score: number
}

/** exact prefix > word-boundary prefix > substring. Pure; instant at ~9k rows. */
export const searchStops = (
  index: ReadonlyArray<StopIndexEntry>,
  query: string,
  limit = 10,
): Array<Candidate> => {
  const q = fold(query.trim())
  if (q.length === 0) return []
  const out: Array<Candidate> = []
  for (const entry of index) {
    let score = 0
    if (entry.norm.startsWith(q)) score = 100
    else {
      const at = entry.norm.indexOf(q)
      if (at > 0 && !/[a-z0-9]/.test(entry.norm[at - 1])) score = 80
      else if (at > 0) score = 60
    }
    if (score > 0) out.push({ entry, score })
  }
  out.sort(
    (a, b) =>
      b.score - a.score ||
      a.entry.norm.length - b.entry.norm.length ||
      a.entry.norm.localeCompare(b.entry.norm),
  )
  return out.slice(0, limit)
}
