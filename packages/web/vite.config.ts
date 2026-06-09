import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      // Generate the icon set from public/icon.svg and inject the
      // apple-touch-icon / favicon / manifest-icon links (reads pwa-assets.config.ts).
      pwaAssets: { config: true },
      manifest: {
        name: "tablo",
        short_name: "tablo",
        description: "Prague public-transport departures",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#08080a",
        background_color: "#08080a",
        // icons are injected by the pwaAssets integration (see Task 7 verification)
      },
      workbox: {
        // App shell only — NO data/**. (.json is not in this list, so the
        // hashed stop index is never precached.)
        globPatterns: ["**/*.{js,css,html,woff2,svg,png,ico}"],
        // icon.svg is the generator *source*, not a runtime asset (browsers use the
        // generated PNGs) — keep it out of the app-shell precache.
        globIgnores: ["icon.svg"],
        // Real-time API is never cached and never navigation-fallback'd.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Hash-immutable stop index -> cache forever; keep the last few hashes.
            urlPattern: /\/data\/stop-index-[^/]+\.json$/,
            handler: "CacheFirst",
            options: {
              cacheName: "stop-index",
              expiration: { maxEntries: 3, maxAgeSeconds: 60 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Tiny pointer -> serve instantly (warm/offline), revalidate in background.
            urlPattern: /\/data\/stops-manifest\.json$/,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "stops-manifest",
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: { "/api": { target: "http://localhost:1337", ws: true } },
  },
})
