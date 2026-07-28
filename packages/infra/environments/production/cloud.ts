import { cloudflareModule } from "../../modules/cloudflare";
import db from "./d1";

// Cloud crux — the single Worker (ADR-0004). Topology lives in the package's
// own wrangler.jsonc, including the D1 binding by id.
//
// `imports: [db]` is load-bearing, not documentation: it makes the d1 instance
// apply first, so the schema is always at least as new as the code that reads
// it. Without it a deploy can ship a Worker whose tables do not exist yet —
// which is exactly how this deployment ended up serving a sign-in page with no
// auth tables behind it.
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
// BETTER_AUTH_SECRET rides in secrets.yaml like every other Zabaca secret:
// zbc resolves it from this environment and pipes it to `wrangler secret put`
// over stdin, so it never lands in argv or a log. Pushing it by hand would
// leave the deployment unreproducible and give CI (CRUX-YALOJ9) nothing to
// push. CLOUDFLARE_API_TOKEN is also in secrets.yaml but is the deploy
// credential, not a Worker binding — hence not listed here.
export default cloudflareModule.instance({
  name: "cloud",
  config: {
    workdir: "apps/cloud",
    build: { command: "bun run build", cwd: "." },
    accountId: "99a19e584439be0568f33aad0477372b",
    workerSecrets: ["BETTER_AUTH_SECRET"],
  },
  imports: [db],
});
