import { cloudflareModule } from "../../modules/cloudflare";

// Cloud crux — the single Worker (ADR-0004). Topology lives in the package's
// own wrangler.jsonc, including the D1 binding: D1 has no zbc module, so the
// database was created once with `wrangler d1 create crux-production` and is
// bound there by id.
//
// The build is `bun run build` at the repo root: it derives the doc tree
// (ADR-0005) and then runs `astro build`, which reads apps/cloud/wrangler.jsonc
// and writes a *resolved* copy of it — plus the bundled entry — into
// apps/cloud/dist/server, along with a .wrangler/deploy/config.json pointing at
// it. The deploy workdir is therefore the package root, not dist/server:
// wrangler reads that redirect and follows it. Pointing wrangler straight at
// dist/server makes it find both configs with different base paths and refuse
// to guess ("Found both a user configuration file ... and a deploy
// configuration file"). The hand-written wrangler.jsonc stays the source of
// truth for the topology.
//
// No workerSecrets: BETTER_AUTH_SECRET is pushed by hand
// (`wrangler secret put`) rather than held in secrets.yaml.
// CLOUDFLARE_API_TOKEN in secrets.yaml is the deploy credential, not a Worker
// binding.
export default cloudflareModule.instance({
  name: "cloud",
  config: {
    workdir: "apps/cloud",
    build: { command: "bun run build", cwd: "." },
    accountId: "99a19e584439be0568f33aad0477372b",
  },
});
