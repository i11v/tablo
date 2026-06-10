import type { Selection } from "./url.ts"
import { decodeSelection, encodeSelection } from "./url.ts"

const SELECTION_KEY = "tablo.selection"
const RECENTS_KEY = "tablo.recents"

/**
 * Storage access can throw (Safari "Block all cookies", embedded webviews,
 * quota), and loadSelection runs inside the first render — an unguarded
 * throw white-screens the app. Persistence is an enhancement here, never a
 * requirement: degrade to empty values / no-ops.
 */
const readLocal = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const writeLocal = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // blocked or quota-exceeded — the value just won't persist
  }
}

/** URL ?s= wins (shareable links), localStorage restores otherwise. */
export const loadSelection = (): Array<Selection> => {
  const fromUrl = new URLSearchParams(location.search).get("s")
  if (fromUrl !== null && fromUrl !== "") return decodeSelection(fromUrl)
  return decodeSelection(readLocal(SELECTION_KEY) ?? "")
}

export const saveSelection = (sel: ReadonlyArray<Selection>): void => {
  const encoded = encodeSelection(sel)
  writeLocal(SELECTION_KEY, encoded)
  const url = new URL(location.href)
  if (encoded === "") url.searchParams.delete("s")
  else url.searchParams.set("s", encoded)
  history.replaceState(null, "", url)
}

export const loadRecents = (): Array<string> => {
  try {
    const parsed: unknown = JSON.parse(readLocal(RECENTS_KEY) ?? "[]")
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}

export const pushRecent = (node: number): void => {
  const next = [String(node), ...loadRecents().filter((n) => n !== String(node))].slice(0, 8)
  writeLocal(RECENTS_KEY, JSON.stringify(next))
}

/**
 * Per-tab session id, deliberately NOT persisted. sessionStorage is copied
 * into duplicated tabs (Chrome/Firefox "Duplicate Tab", some Safari
 * restores), which made two tabs share one ClientSession DO and clobber
 * each other's subscriptions — the losing tab's board went blank while
 * still showing "live". A module-level id gives every tab and every reload
 * its own session; that's free because the client re-subscribes on every
 * connect and the worker drops session storage when the last socket closes.
 */
let tabSessionId: string | undefined
export const sessionId = (): string => (tabSessionId ??= crypto.randomUUID())
