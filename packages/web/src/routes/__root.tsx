import { lazy, Suspense, useEffect } from "react"
import { createRootRoute, Outlet } from "@tanstack/react-router"
import { startGeoWatch } from "../store.ts"

// Lazy + PROD-stubbed so the devtools bundles are tree-shaken out of production.
const RouterDevtools = import.meta.env.PROD
  ? () => null
  : lazy(() =>
      import("@tanstack/react-router-devtools").then((m) => ({
        default: m.TanStackRouterDevtools,
      })),
    )

const QueryDevtools = import.meta.env.PROD
  ? () => null
  : lazy(() =>
      import("@tanstack/react-query-devtools").then((m) => ({
        default: m.ReactQueryDevtools,
      })),
    )

// The board's share link lives in `?s=` (see lib/storage.ts). Validating it on
// the root makes it a typed, router-owned search param every route inherits, so
// navigations can carry it through instead of the router dropping it as unknown.
type RootSearch = { s?: string }

// The shell every page renders into. Page chrome (AppBar/SubBar) lives in the
// index page, so the layout stays a thin <Outlet />; the root's one job is to
// start the geolocation watch once for the whole session. (The stop index loads
// lazily via TanStack Query the first time a page reads it.)
export const Route = createRootRoute({
  component: RootLayout,
  validateSearch: (search: Record<string, unknown>): RootSearch =>
    typeof search.s === "string" && search.s !== "" ? { s: search.s } : {},
})

function RootLayout() {
  useEffect(() => {
    startGeoWatch()
  }, [])
  return (
    <>
      <Outlet />
      <Suspense>
        <RouterDevtools />
        <QueryDevtools />
      </Suspense>
    </>
  )
}
