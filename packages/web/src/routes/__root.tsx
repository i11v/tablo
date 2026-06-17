import { lazy, Suspense } from "react"
import { createRootRoute, Outlet } from "@tanstack/react-router"

// Lazy + PROD-stubbed so the devtools bundle is tree-shaken out of production.
const RouterDevtools = import.meta.env.PROD
  ? () => null
  : lazy(() =>
      import("@tanstack/react-router-devtools").then((m) => ({
        default: m.TanStackRouterDevtools,
      })),
    )

// The shell every page renders into. Page-agnostic on purpose: chrome
// (AppBar/SubBar) currently lives in the index page, so the root stays a thin
// <Outlet /> until shared layout is actually needed across routes.
export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <>
      <Outlet />
      <Suspense>
        <RouterDevtools />
      </Suspense>
    </>
  )
}
