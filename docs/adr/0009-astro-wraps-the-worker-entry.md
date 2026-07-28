# Astro wraps the Worker entry, and workerd tests the built bundle

ADR-0004 chose Astro with React islands; ADR-0008 deferred it to the ticket that
needed islands and named one blocker. Astro has now landed, and both halves of
that blocker are settled here.

**Astro wraps `src/index.ts`; it does not replace it.** The adapter's
`workerEntryPoint` option keeps the hand-written entry as the Worker's entry —
it still owns `/health`, `/v1` and the server-rendered pages, and `namedExports:
["ViewStateDO"]` is what keeps the Durable Object class exported through the
bundle, so the migration in `wrangler.jsonc` still refers to something that
exists. The entry offers Astro the routes Astro owns (a list, in `ASTRO_PATHS`)
and handles the rest itself. One Worker, two renderers, one `Env`.

The delegation is an explicit path list rather than "try Astro, fall through on
404" because Astro answers an *unrouted POST* with 403 from its CSRF origin
check, not 404 — which would have swallowed the hand-written form posts for
sign-in, invites and tokens.

**The workerd suites run against the built bundle.** ADR-0008's blocker was that
`@cloudflare/vitest-pool-workers` loads `main` from `wrangler.jsonc` without
running Astro's vite plugin, so an entry importing Astro's handler cannot resolve
`virtual:astro-cloudflare:config` and the suites fail to *collect*. The fix is to
point the pool at the config Astro *generates* — `dist/server/wrangler.json`,
whose `main` is the already-bundled `entry.mjs` — and to run `astro build`
first. The virtual module is resolved at build time, before workerd ever sees the
code.

This is a better arrangement than the one it replaces, not merely a workaround:
the tests now exercise the artifact that gets deployed rather than a
differently-bundled copy of its sources. The same generated config is what
`zbc apply` deploys, so the topology in `wrangler.jsonc` is resolved once and
used by both.

**The browser writes through `/v1`, authenticated by its session cookie.** The
islands POST to `POST /v1/dispatch` — the CLI's endpoint, running the same
`dispatch()`. `/v1` therefore accepts either front door (ADR-0007): a bearer
token, or a Better Auth session. A cookie is ambient credential, so a
cookie-authenticated write must also be same-origin; a bearer token is exempt
because no browser sends one it was not given.

## Consequences

- **`bun run test` now builds first.** `test:workers` runs `bun run build`
  (derive the docs, then `astro build`) before either vitest runner. A stale
  `dist/` means testing the previous commit, so the build is not optional and is
  not cached.
- **The deploy workdir is `apps/cloud`,** the package root.
  `apps/cloud/wrangler.jsonc` remains the source of truth for the topology and
  the generated `dist/server/wrangler.json` is its resolved form — but wrangler
  must be pointed at the package root, not at the generated file. `astro build`
  also writes `apps/cloud/.wrangler/deploy/config.json`, a redirect to the
  generated config; run wrangler from `dist/server` and it finds both, sees two
  different base paths, and refuses to guess which is authoritative. This bullet
  originally said `dist/server`, which never deployed.
- **Astro's own session store and image service are turned off** (`session:
  { driver: "memory" }`, `imageService: "passthrough"`). Left at their defaults
  the adapter declares `SESSION` KV and `IMAGES` bindings — infrastructure to
  create and keep alive for features nothing here calls. Browser sessions are
  Better Auth's (ADR-0007), and the site serves no images.
- **Two TypeScript projects in one package.** `apps/cloud/tsconfig.json` is
  workerd code; `apps/cloud/astro/tsconfig.json` is the islands, which need the
  DOM lib. `.astro` files are checked by `astro build`, not by tsc, and are
  excluded from oxlint, which has no parser for them.
- **Live refresh is per-Member, not per-deployment.** The push stream is that
  Member's ViewStateDO, so a second tab or a `crux` command in a terminal lands
  on the page, while another Member's write does not. Cross-Member push would
  need a fan-out the DO does not have today.
