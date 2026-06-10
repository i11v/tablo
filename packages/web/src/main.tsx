import { createRoot } from "react-dom/client"
import { registerSW } from "virtual:pwa-register"
import { App } from "./App.tsx"
import "./styles.css"

// autoUpdate: the new worker takes control silently and applies on the next
// navigation. No prompt UI to build (single-user app).
void registerSW({ immediate: true })

createRoot(document.getElementById("root")!).render(<App />)
