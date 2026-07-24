import { cloudflareModule } from "../../modules/cloudflare";

// Cloud crux — the single Worker (ADR-0004). Topology lives in the package's
// own wrangler.jsonc, including the D1 binding: D1 has no zbc module, so the
// database was created once with `wrangler d1 create crux-production` and is
// bound there by id.
//
// No build step yet — the Worker is a bare src/index.ts. When the Astro shell
// lands (CRUX-6D86GE) it gains a `build` block, the same way zbc's landing
// instance does.
//
// No workerSecrets either: nothing in the Worker reads a secret until auth
// arrives (CRUX-6D86GE). CLOUDFLARE_API_TOKEN in secrets.yaml is the deploy
// credential, not a Worker binding.
export default cloudflareModule.instance({
  name: "cloud",
  config: {
    workdir: "apps/cloud",
    accountId: "99a19e584439be0568f33aad0477372b",
  },
});
