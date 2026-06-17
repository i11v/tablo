import { useMemo } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { selectorKey } from "@app/contract"
import { SearchView } from "../components/search.tsx"
import { useAppStore } from "../store.tsx"

// The stop search as a real page. Exercises the router foundation: it reads the
// shared selection/index from the root provider, and adding a stop (or closing)
// navigates back to the board, which already reflects the new selection.
export const Route = createFileRoute("/search")({
  component: SearchPage,
})

function SearchPage() {
  const { index, geo, selection, add, remove } = useAppStore()
  const navigate = useNavigate()
  const back = (): void => {
    void navigate({ to: "/" })
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
        onAdd={add}
        onRemove={remove}
      />
    </div>
  )
}
