import { createRouter, RouterProvider } from "@tanstack/react-router"
import { createRoot } from "react-dom/client"
import { registerSW } from "virtual:pwa-register"
import { routeTree } from "./routeTree.gen.ts"
import "./styles.css"

// autoUpdate: the new worker takes control silently and applies on the next
// navigation. No prompt UI to build (single-user app).
void registerSW({ immediate: true })

const router = createRouter({ routeTree })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />)
