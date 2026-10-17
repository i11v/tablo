import { createFileRoute } from "@tanstack/react-router"
import { App } from "../App.tsx"

// The departures board. Selection lives in selectionStore and is mirrored to
// the `?s=` share param (saveSelection -> history.replaceState). `s` is
// validated on the root route and carried through navigations (see App /
// search routes), so deep links and share links survive routing.
export const Route = createFileRoute("/")({
  component: App,
})
