import { createFileRoute } from "@tanstack/react-router"
import "maplibre-gl/dist/maplibre-gl.css"
import { MapScreen } from "../components/map/MapScreen.tsx"

// The live map view. autoCodeSplitting (vite.config.ts) makes this module — and
// its heavy maplibre-gl import — a lazy route chunk, kept out of the entry bundle.
export const Route = createFileRoute("/map")({ component: MapScreen })
