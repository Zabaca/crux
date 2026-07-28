// @ts-check
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";

/**
 * The Astro shell ADR-0004 chose, on the same Worker as the JSON API.
 *
 * `workerEntryPoint` is what keeps that a single Worker: the hand-written
 * `src/index.ts` stays the entry — it still owns `/health`, `/v1` and the
 * server-rendered read pages, and it still exports `ViewStateDO` — and Astro
 * wraps it rather than replacing it. `namedExports` is why the Durable Object
 * survives the bundle; without it the class is tree-shaken and the migration
 * in `wrangler.jsonc` refers to a class that is no longer exported.
 */
export default defineConfig({
  output: "server",
  srcDir: "./astro",
  outDir: "./dist",
  integrations: [react()],
  // Astro's own session store is unused — browser sessions are Better Auth
  // cookies (ADR-0007). Left to its default the adapter would declare a
  // `SESSION` KV namespace in the generated config, which is then a namespace
  // to create, bind and keep alive for a feature nothing calls. Same for
  // `IMAGES`: this site serves no images.
  session: { driver: "memory" },
  adapter: cloudflare({
    imageService: "passthrough",
    workerEntryPoint: {
      path: "src/index.ts",
      namedExports: ["ViewStateDO"],
    },
  }),
});
