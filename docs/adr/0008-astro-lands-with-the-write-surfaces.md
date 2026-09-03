# Astro lands with the write surfaces, not with the read pages

> **Overtaken (2026-09-03).** The read pages moved to Astro too — the Workstream
> list, the Problem and both Observation pages — because live refresh needs a
> subscription and a subscription needs an island. The reasoning below still
> holds for what it decided (*when* Astro arrives, and why not before the write
> surfaces); what it no longer describes is the split, which now runs between
> the pages showing corpus data and the account pages rather than between write
> and read. The test-loop cost it names was paid once, as it predicted, and the
> "routing change rather than a rewrite" consequence is what made the later move
> cheap: the views are still the same functions in `apps/cloud/src/web/`.

ADR-0004 chose Astro with React islands for the UI. The first browser surfaces —
sign-in, invites, CLI tokens, and the read pages for Workstream, Problem,
Solution and Observation — ship instead as plain server-rendered HTML from the
hand-written Worker entry. Astro arrives with the write surfaces that need
islands. This amends ADR-0004's timing; it does not overturn its choice.

The reason is measured, not assumed. Astro 7 with `@astrojs/cloudflare` 14 does
coexist with this Worker: `astro build` succeeds, the generated
`dist/server/wrangler.json` keeps the D1 and Durable Object bindings, and
`ViewStateDO` survives the bundle as a named export
(`export { ViewStateDO, worker_entry_default as default }`). None of that is the
obstacle. The obstacle appears one step later, when the entry actually *serves*
an Astro page and therefore has to import Astro's handler:

```
Error: Cannot find package 'virtual:astro-cloudflare:config'
  imported from node_modules/@astrojs/cloudflare/dist/utils/handler.js
  ❯ workers-test/api.workerd.ts
  ❯ workers-test/web.workerd.ts
```

`virtual:astro-cloudflare:config` is a build-time virtual module supplied by
Astro's vite plugin. `@cloudflare/vitest-pool-workers` loads the Worker from
`wrangler.jsonc`'s `main` without that plugin, so the import cannot resolve and
*both* suites fail to collect — not one test, the whole file. Serving Astro
pages from this Worker therefore means either running `astro build` before every
`vitest run`, or teaching the pool to run Astro's plugin.

That is a real cost and it lands on the thing ADR-0006 exists to protect: the
suite that tests the invariants inside workerd, which today collects in about
three seconds and is the seam this work is verified through. Paying it to render
pages that have no interactivity — the read surfaces are read-only, so there are
no islands to hydrate and Astro's routing would replace a fifteen-line regex
table — buys nothing yet. CRUX-AUMA25 brings the board and the action forms,
which do need islands; that is where the cost buys something, and where the
test-loop question gets solved once for a reason.

Two smaller findings, recorded so the next attempt does not rediscover them:
the adapter injects a `SESSION` KV namespace and an `IMAGES` binding into the
generated config unless they are declared, so both need provisioning at deploy;
and `main` in `wrangler.jsonc` points at *source*, which is why the build reuses
the existing entry rather than replacing it.

## Consequences

- **The pages are HTML template functions, not `.astro` files.** They live in
  `apps/cloud/src/web/` behind plain functions that return an escaped-by-default
  `Html` value. Astro pages can call those same functions, so the migration is a
  routing change rather than a rewrite of the views.
- **ADR-0004's "a rewrite, not a port" still stands** for the UI as a whole. What
  moved is when.
- **This is the deadline for the decision.** If CRUX-AUMA25 also defers Astro,
  ADR-0004 is being ignored rather than amended, and the honest move then is to
  revisit ADR-0004 itself.
