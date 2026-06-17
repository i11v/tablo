import { selectorKey, type StopSelector } from "@app/contract"

export interface Selection {
  readonly selector: StopSelector
  readonly name: string
}

/**
 * The router search object carrying the live `?s=` from the address bar.
 * `saveSelection` keeps that param current via `history.replaceState`, which
 * the router does not observe — so route navigations pass this through
 * explicitly, preserving the share link across page changes (the router drops
 * search params it isn't told to keep). Omits `s` entirely when absent or empty.
 */
export const shareSearch = (): { s?: string } => {
  const s = new URLSearchParams(location.search).get("s")
  return s ? { s } : {}
}

/** "1040~And%C4%9Bl;81_1_2~D%C4%9Bln..." — node[_stop...]~encodedName;… */
export const encodeSelection = (sel: ReadonlyArray<Selection>): string =>
  sel
    .map((s) => {
      const head =
        s.selector.stops === null
          ? String(s.selector.node)
          : [s.selector.node, ...s.selector.stops].join("_")
      return head + "~" + encodeURIComponent(s.name)
    })
    .join(";")

export const decodeSelection = (raw: string): Array<Selection> => {
  if (raw === "") return []
  const out: Array<Selection> = []
  // Dedupe by selector: a hand-edited or doubled-up shared URL would
  // otherwise produce duplicate React keys and remove() would drop both.
  const seen = new Set<string>()
  for (const part of raw.split(";")) {
    const tilde = part.indexOf("~")
    if (tilde === -1) continue
    const head = part.slice(0, tilde)
    const encName = part.slice(tilde + 1)
    const nums = head.split("_")
    if (nums.some((n) => !/^\d+$/.test(n))) continue
    let name: string
    try {
      name = decodeURIComponent(encName)
    } catch {
      continue
    }
    const [node, ...stops] = nums.map(Number)
    const selector: StopSelector = { node, stops: stops.length === 0 ? null : stops }
    const key = selectorKey(selector)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ selector, name })
  }
  return out
}
