import { lazy, Suspense } from "react"
import { createRootRoute, Outlet } from "@tanstack/react-router"
import { AppProvider } from "../store.tsx"

// Lazy + PROD-stubbed so the devtools bundle is tree-shaken out of production.
const RouterDevtools = import.meta.env.PROD
  ? () => null
  : lazy(() =>
      import("@tanstack/react-router-devtools").then((m) => ({
        default: m.TanStackRouterDevtools,
      })),
    )

// The shell every page renders into. Page chrome (AppBar/SubBar) still lives in
// the index page, so the layout stays a thin <Outlet />; the root's job is to
// host AppProvider so selection + stop index are shared across routes.
export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <AppProvider>
      <Outlet />
      <Suspense>
        <RouterDevtools />
      </Suspense>
    </AppProvider>
  )
}
