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
        name: "tablo.",
        short_name: "tablo.",
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
        // icon.png is the generator *source*, not a runtime asset (browsers use the
        // generated PNGs) — keep it out of the app-shell precache.
        globIgnores: ["icon.png"],
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
              // Same-origin fetches are never opaque (status 0) — only cache
              // real 200s. The worker answers missing hashed files with 404
              // (never the SPA fallback HTML), so a miss can't poison this cache.
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Tiny pointer -> serve instantly (warm/offline), revalidate in background.
            urlPattern: /\/data\/stops-manifest\.json$/,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "stops-manifest",
              cacheableResponse: { statuses: [200] },
            },
          },
          // The Doto/Hanken look IS the product; without these the installed
          // app falls back to system fonts exactly when a transit board is
          // most used (offline / flaky network underground).
          {
            // Stylesheet: tiny, rotates when Google re-shards font files.
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts-css" },
          },
          {
            // Font binaries are immutable per URL -> cache for a year.
            // Status 0 is required here: <link>-initiated no-cors fetches
            // surface as opaque responses.
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-files",
              expiration: { maxEntries: 12, maxAgeSeconds: 365 * 24 * 60 * 60 },
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
