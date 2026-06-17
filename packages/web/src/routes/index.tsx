import { createFileRoute } from "@tanstack/react-router"
import { App } from "../App.tsx"

// The departures board. App still owns its own `?s=` selection state via
// history.replaceState; TanStack Router preserves that unvalidated search param
// across navigations, so the existing share-link behaviour is untouched.
export const Route = createFileRoute("/")({
  component: App,
})
