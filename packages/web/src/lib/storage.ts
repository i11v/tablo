import type { Selection } from "./url.ts"
import { decodeSelection, encodeSelection } from "./url.ts"

const SELECTION_KEY = "tablo.selection"
const RECENTS_KEY = "tablo.recents"
const SESSION_KEY = "tablo.session"

/** URL ?s= wins (shareable links), localStorage restores otherwise. */
export const loadSelection = (): Array<Selection> => {
  const fromUrl = new URLSearchParams(location.search).get("s")
  if (fromUrl !== null && fromUrl !== "") return decodeSelection(fromUrl)
  return decodeSelection(localStorage.getItem(SELECTION_KEY) ?? "")
}

export const saveSelection = (sel: ReadonlyArray<Selection>): void => {
  const encoded = encodeSelection(sel)
  localStorage.setItem(SELECTION_KEY, encoded)
  const url = new URL(location.href)
  if (encoded === "") url.searchParams.delete("s")
  else url.searchParams.set("s", encoded)
  history.replaceState(null, "", url)
}

export const loadRecents = (): Array<string> => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]")
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}

export const pushRecent = (node: number): void => {
  const next = [String(node), ...loadRecents().filter((n) => n !== String(node))].slice(0, 8)
  localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
}

/** Per-tab so each tab gets its own ClientSession DO; sessionStorage survives reloads but not new tabs. */
export const sessionId = (): string => {
  let id = sessionStorage.getItem(SESSION_KEY)
  if (id === null) {
    id = crypto.randomUUID()
    sessionStorage.setItem(SESSION_KEY, id)
  }
  return id
}
