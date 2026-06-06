import type { StopSelector } from "@app/contract"

export interface Selection {
  readonly selector: StopSelector
  readonly name: string
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
    out.push({ selector: { node, stops: stops.length === 0 ? null : stops }, name })
  }
  return out
}
