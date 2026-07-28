import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// The Worker's own tests run inside workerd (ADR-0006), against the bindings
// its wrangler config declares: a local D1 and a real ViewStateDO. That is what
// makes `SELF.fetch` in these tests the deployed request path rather than a
// hand-assembled stand-in for it.
//
// The config is the one Astro's adapter *generates* (`dist/server/wrangler.json`),
// not the hand-written `wrangler.jsonc`, and `main` in it is the already-bundled
// `entry.mjs`. That is deliberate and is the whole answer to ADR-0008's blocker:
// the pool does not run Astro's vite plugin, so a source entry that imports
// Astro's handler cannot resolve `virtual:astro-cloudflare:config` and the suite
// fails to *collect*. Testing the built artifact resolves it before workerd sees
// it — and means these tests run against the bundle that gets deployed. The cost
// is that `astro build` has to run first; `bun run test:workers` does that.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./dist/server/wrangler.json" },
      miniflare: {
        d1Databases: ["DB"],
        kvNamespaces: ["SESSION"],
        compatibilityFlags: ["nodejs_compat"],
        // In production this is a Worker secret. The browser surfaces refuse to
        // issue sessions without it, so the suite has to supply one.
        bindings: { BETTER_AUTH_SECRET: "test-secret-not-used-in-production" },
      },
    }),
  ],
  test: {
    include: ["workers-test/**/*.workerd.ts"],
    // The test files import core directly (to seed D1 and to dispatch), and
    // core reaches xstate, whose ESM build re-exports across files. With `main`
    // now pointing at a pre-bundled entry the pool no longer pre-bundles that
    // graph for the test module itself, so it has to be asked to.
    deps: { optimizer: { ssr: { enabled: true, include: ["xstate"] } } },
  },
});
