# The Cloudflare stack: one Worker, Astro islands, D1

Cloud crux ships as a single Cloudflare Worker holding the Astro site and the JSON API together, with D1 as the database and a per-user Durable Object for view-state. Deployment is zbc: `zbc init` in the repo, a `cloudflare` module instance, SOPS-encrypted secrets, deploys by hand until they are boring and then on merge to main via zbc's production workflow. No preview environment for now.

**One Worker, not two.** Static assets, the JSON API, and auth ship together — the shape zbc's `inbox` Worker already uses. Splitting the API out would duplicate auth across both Workers and add CORS and service bindings for a deployment serving a handful of people. A versioned route prefix protects the CLI contract more cheaply than a second Worker.

**D1, not Turso.** Turso was the plan only because of embedded replicas, which ADR-0003 rejects. Once nothing outside the Worker touches the database, D1's central constraint stops mattering and its advantages land: it is a binding rather than a network service, so there is no database token to mint, store, or rotate and no HTTP hop from the Worker to another provider, and it brings point-in-time restore for a corpus that cannot be recreated. Drizzle's `sqliteTable` schema is shared between drivers, so the schema ports unchanged and only the client and migrator swap.

**Astro with React islands, replacing Next.js.** Most of crux's surfaces are reads that want to be pages, with interactivity concentrated in the roadmap board and the action dialogs, which carry over as islands. This matches cedarpad's `www` stack (`@astrojs/cloudflare`), so the deployment path is proven in-house, and it removes OpenNext — an adapter layer nobody at Zabaca operates — from the critical path. This was chosen against the recommendation to port Next.js as-is: the cost is a rewrite of routing, layout, and data loading, paid once, against a deployment path that is house-standard from then on.

**A per-user Durable Object for view-state.** View-state was a local JSON file plus a file-watcher, which has no cloud equivalent and, with teammates, can no longer be one global cursor. The DO gives per-user state and a push stream, following the `inbox` pattern.

## Consequences

- **The web app is rewritten, not ported.** `@dnd-kit` and dialog components survive as islands; Next.js routing, API routes, and their tests do not.
- **Shared state across islands is now a design constraint.** Astro makes cross-island coordination awkward; if the roadmap board grows into the primary surface, this is where it will hurt.
- **D1 has no zbc module.** The database is created once with `wrangler d1 create` and bound by id, as cedarpad does — or a D1 module gets written for zbc, which would be a near-copy of the existing `r2` module.
- **The push stream pays for itself twice.** It backs live refresh *and* lets `/api/notify` survive as a local bridge: the plugin subscribes and writes into the agent inbox, so browser-pokes-agent keeps working with the browser in the cloud.
- **Tests run in workerd locally** via Miniflare — no network and no account required. Which test runner survives the move is a build-time question, not a settled one.
