import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["packages/*/test-integration/**/*.test.ts"],
    environment: "node",
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    // Spawns a real `bun alchemy dev` stack (local workerd + both DOs) on an
    // isolated stage/port and exposes its base URL via TABLO_INTEGRATION_URL.
    globalSetup: ["packages/worker/test-integration/global-setup.ts"],
  },
})
