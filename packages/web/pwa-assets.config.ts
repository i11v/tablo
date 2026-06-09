import { defineConfig, minimal2023Preset as preset } from "@vite-pwa/assets-generator/config"

export default defineConfig({
  // Inject apple-touch-icon + favicon <link> tags into index.html (2023 head preset).
  headLinkOptions: { preset: "2023" },
  preset,
  images: ["public/icon.png"],
})
