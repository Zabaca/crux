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
        // In production these are Worker secrets/vars. The browser surfaces
        // refuse to issue sessions without the first and refuse to send sign-in
        // links without the other two, so the suite has to supply all three.
        bindings: {
          BETTER_AUTH_SECRET: "test-secret-not-used-in-production",
          RESEND_API_KEY: "re_test_not_a_real_key",
          EMAIL_FROM: "crux@test.invalid",
          // The free allowance (ADR-0013), deliberately tiny here: the cap is a
          // deployment var rather than a constant, and capacity.workerd.ts can
          // only reach it by filing five Observations instead of two hundred.
          // Nothing else in the suite files more than a handful per test.
          CRUX_OBSERVATION_CAP: "5",
        },
        // Every outbound fetch from the Worker under test lands here instead of
        // the network, so the suite never mails anyone and never depends on
        // Resend being reachable. Anything that is not the send endpoint fails
        // loudly: a new outbound call appearing in a browser surface is
        // something a test should have to acknowledge, not something that
        // silently works.
        outboundService: (request: Request) =>
          new URL(request.url).hostname === "api.resend.com"
            ? Response.json({ id: "test-message" })
            : new Response("unexpected outbound request", { status: 502 }),
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
