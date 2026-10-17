// vite/client is provided globally via tsconfig.json `types`; this file only adds
// the virtual:pwa-register module types.
/// <reference types="vite-plugin-pwa/client" />

// Build-time constant injected by vite.config.ts `define`: the hashed stop-index
// path, or null when the manifest wasn't built (dev/fresh checkout). See
// fetchStopIndex in hooks/useStopIndex.ts.
declare const __STOP_INDEX_PATH__: string | null
