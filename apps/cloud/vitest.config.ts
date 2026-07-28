import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// The Worker's own tests run inside workerd (ADR-0006), against the bindings
// its wrangler config declares: a local D1 and a real ViewStateDO. That is what
// makes `SELF.fetch` in these tests the deployed request path rather than a
// hand-assembled stand-in for it.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        d1Databases: ["DB"],
        compatibilityFlags: ["nodejs_compat"],
        // In production this is a Worker secret. The browser surfaces refuse to
        // issue sessions without it, so the suite has to supply one.
        bindings: { BETTER_AUTH_SECRET: "test-secret-not-used-in-production" },
      },
    }),
  ],
  test: {
    include: ["workers-test/**/*.workerd.ts"],
  },
});
