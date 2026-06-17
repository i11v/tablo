import { useMemo } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useSelector } from "@tanstack/react-store"
import { selectorKey } from "@app/contract"
import { SearchView } from "../components/search.tsx"
import { useStopIndex } from "../hooks/useStopIndex.ts"
import { shareSearch } from "../lib/url.ts"
import { geoStore, selectionStore } from "../store.ts"

// The stop search as a real page. Exercises the router foundation: it reads the
// shared selection/index stores, and adding a stop (or closing) navigates back
// to the board, which already reflects the new selection.
export const Route = createFileRoute("/search")({
  component: SearchPage,
})

function SearchPage() {
  const index = useStopIndex()
  const geo = useSelector(geoStore)
  const selection = useSelector(selectionStore)
  const navigate = useNavigate()
  const back = (): void => {
    // Preserve the live ?s= so returning to the board keeps the share link
    // (a fresh add was just written to the URL via saveSelection).
    void navigate({ to: "/", search: shareSearch() })
  }

  const chosen = useMemo(() => new Set(selection.map((s) => selectorKey(s.selector))), [selection])
  const origin = useMemo(
    () => (geo.tag === "active" ? { lat: geo.lat, lon: geo.lon } : null),
    [geo],
  )

  return (
    <div className="flex min-h-full flex-col px-[14px] pt-[12px] pb-[16px] sm:px-[28px] sm:pt-[18px]">
      <SearchView
        onClose={back}
        indexState={index}
        chosen={chosen}
        origin={origin}
        onAdd={selectionStore.actions.add}
        onRemove={selectionStore.actions.remove}
      />
    </div>
  )
}
