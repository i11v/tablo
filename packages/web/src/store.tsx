import { createContext, use, useMemo, useState } from "react"
import type { ReactNode } from "react"
import { MAX_SELECTORS, selectorKey, type StopSelector } from "@app/contract"
import { useGeo, type Geo } from "./hooks/useGeo.ts"
import { useStopIndex, type IndexState } from "./hooks/useStopIndex.ts"
import { loadSelection, pushRecent, saveSelection } from "./lib/storage.ts"
import type { Selection } from "./lib/url.ts"

/**
 * App-wide state shared across routes. Lives at the root so the board (`/`) and
 * the search page (`/search`) read one selection and one stop index: navigating
 * between them keeps the ~9k-entry index in memory (no refetch/reparse flash)
 * and a stop added on /search is immediately on the board.
 */
export interface AppStore {
  readonly index: IndexState
  readonly geo: Geo
  readonly selection: ReadonlyArray<Selection>
  readonly add: (selector: StopSelector, name: string) => void
  readonly remove: (key: string) => void
}

const Ctx = createContext<AppStore | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const index = useStopIndex()
  const geo = useGeo()
  const [selection, setSelection] = useState<Array<Selection>>(loadSelection)

  const store = useMemo<AppStore>(() => {
    const update = (next: Array<Selection>): void => {
      setSelection(next)
      saveSelection(next)
    }
    return {
      index,
      geo,
      selection,
      add: (selector, name) => {
        // The wire protocol caps Subscribe at MAX_SELECTORS; never build a
        // selection the encoder would reject.
        if (selection.length >= MAX_SELECTORS) return
        // Newest on top: the just-added stop leads the board rather than
        // landing at the bottom.
        update([{ selector, name }, ...selection])
        pushRecent(selector.node)
      },
      remove: (key) => update(selection.filter((s) => selectorKey(s.selector) !== key)),
    }
  }, [index, geo, selection])

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}

export function useAppStore(): AppStore {
  const store = use(Ctx)
  if (store === null) throw new Error("useAppStore must be used within AppProvider")
  return store
}
