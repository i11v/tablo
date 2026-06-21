import type { DepartureVM } from "./departureVM.ts"

/** A board card's data: a stop (or pinned single platform) plus its departures. */
export interface StopVM {
  readonly node: number
  readonly name: string
  readonly walkMinutes: number | null
  /** Platform key when this card is a pinned single platform, else null. */
  readonly pin: string | null
  readonly departures: ReadonlyArray<DepartureVM>
}

export interface PlatformGroup {
  readonly key: string // "A".."H" | "Metro"
  readonly label: string // "nást. A" | "Metro"
  readonly dir: string // first few destinations, joined
  readonly count: number
}

/** Grouping key: metro collapses to one, blank/"–" platforms are unkeyed. */
export const platformKey = (d: DepartureVM): string =>
  d.kind === "metro" ? "Metro" : d.platform && d.platform !== "–" ? d.platform : "?"

/** Distinct platforms present in a board, with a short direction summary. */
export const platformsOf = (
  departures: ReadonlyArray<DepartureVM>,
): ReadonlyArray<PlatformGroup> => {
  const seen = new Map<
    string,
    { key: string; label: string; dests: Array<string>; count: number }
  >()
  for (const d of departures) {
    const key = platformKey(d)
    if (key === "?") continue
    let g = seen.get(key)
    if (g === undefined) {
      g = { key, label: key === "Metro" ? "Metro" : `nást. ${key}`, dests: [], count: 0 }
      seen.set(key, g)
    }
    g.count++
    if (g.dests.length < 3 && !g.dests.includes(d.headsign)) g.dests.push(d.headsign)
  }
  return [...seen.values()].map((g) => ({
    key: g.key,
    label: g.label,
    count: g.count,
    dir: g.dests.join(" · "),
  }))
}
