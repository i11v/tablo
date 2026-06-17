import { lazy, Suspense, useEffect } from "react"
import { createRootRoute, Outlet } from "@tanstack/react-router"
import { startGeoWatch, startStopIndex } from "../store.ts"

// Lazy + PROD-stubbed so the devtools bundle is tree-shaken out of production.
const RouterDevtools = import.meta.env.PROD
  ? () => null
  : lazy(() =>
      import("@tanstack/react-router-devtools").then((m) => ({
        default: m.TanStackRouterDevtools,
      })),
    )

// The shell every page renders into. Page chrome (AppBar/SubBar) lives in the
// index page, so the layout stays a thin <Outlet />; the root's one job is to
// kick off the app-state stores (stop index + geo) once for the whole session.
export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  useEffect(() => {
    startStopIndex()
    startGeoWatch()
  }, [])
  return (
    <>
      <Outlet />
      <Suspense>
        <RouterDevtools />
      </Suspense>
    </>
  )
}
