import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * The invariant suite runs inside workerd against a local Miniflare D1 —
 * no network, no Cloudflare account. See docs/adr/0006-invariants-run-in-workerd.md.
 */
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-07-01",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
