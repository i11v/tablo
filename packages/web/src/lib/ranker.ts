import type { Candidate } from "./matcher.ts"

/**
 * Composable scorer pipeline (spec §5.5): v1 = text relevance + recents boost.
 * Geo-proximity later = one more scorer here; matcher and index stay untouched.
 */
export const rank = (
  candidates: ReadonlyArray<Candidate>,
  recentNodes: ReadonlyArray<string>,
): Array<Candidate> =>
  [...candidates]
    .map((c) => ({
      ...c,
      score: c.score + (recentNodes.includes(String(c.entry.node)) ? 25 : 0),
    }))
    .sort((a, b) => b.score - a.score)
