import { defineConfig, minimal2023Preset as preset } from "@vite-pwa/assets-generator/config"

// The master (public/icon.png) is a FULL-BLEED board that already paints the
// gradient + "t." edge-to-edge. The minimal-2023 preset insets apple/maskable
// icons by 30% on a white matte — that's the shrunken icon with a border you
// see on the iOS Home Screen. Override padding to 0 and match the matte to the
// board's bottom colour so the icon fills the whole tile.
const BOARD = "#08080a" // --color-board bottom stop

export default defineConfig({
  // Inject apple-touch-icon + favicon <link> tags into index.html (2023 head preset).
  headLinkOptions: { preset: "2023" },
  preset: {
    ...preset,
    transparent: { ...preset.transparent, padding: 0 },
    maskable: { ...preset.maskable, padding: 0, resizeOptions: { background: BOARD } },
    apple: { ...preset.apple, padding: 0, resizeOptions: { background: BOARD } },
  },
  images: ["public/icon.png"],
})
