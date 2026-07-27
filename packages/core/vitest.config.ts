import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Vitest with the Workers pool — the only runner that executes test code inside
// workerd itself (ADR-0006). `bun test` still owns everything else in this repo;
// the `.workerd.ts` suffix keeps these files off bun's default matcher, so the
// two runners never fight over the same file.
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-07-23",
        compatibilityFlags: ["nodejs_compat"],
        // A local, in-memory D1 — no network, no Cloudflare account.
        d1Databases: ["DB"],
      },
    }),
  ],
  test: {
    include: ["workers-test/**/*.workerd.ts"],
  },
});
