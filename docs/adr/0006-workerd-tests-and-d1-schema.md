# Invariant tests run in workerd; the cloud schema is an end state

Two questions the cloud-crux spec deliberately left open, settled together
because they are the same question from different sides: how does code that will
run inside a Worker get tested, and what does "the schema" mean once there is no
drizzle-kit to run.

**Tests that touch D1 run under Vitest with `@cloudflare/vitest-pool-workers`.**
The alternative on the table was `bun test` driving Miniflare or wrangler's
`getPlatformProxy()`. Both hand you working D1 bindings, and for asserting on
query results that would have been enough. Neither runs the *test file* inside
workerd — the code under test executes on Node or Bun and reaches across to a
binding. That gap is exactly where the interesting failures live: workerd is not
Node, and a transition that passes on Bun while importing something workerd has
no polyfill for is a bug this suite must catch, not one it must be blind to.
The pool runs the tests in the same runtime the Worker will, so "the invariants
hold on D1" is tested as a statement about production rather than about a
proxy.

The cost is a second runner in a repo that had one. It is contained by scope
rather than by convention: the pool owns `packages/core/workers-test/` and
nothing else, and `bun test` still owns every other test in the repo. The
`.workerd.ts` suffix is what keeps them apart — bun's default matcher looks for
`.test.ts` / `.spec.ts`, so it walks past these files without configuration, and
`bun run test` runs both runners in sequence.

**The cloud schema is defined by its end state, not by replaying migrations.**
`packages/core/src/db/migrations/` is a history: 0002 collapses a status column,
0004 merges Idea into Observation, 0005 rewrites two primary keys. Replaying
that onto an empty database is a fragile route to a state we can simply declare,
and there is no runtime migrator inside workerd to replay it with. So
`packages/core/src/db/d1/` holds the same schema as `CREATE TABLE IF NOT
EXISTS`, and `applyD1Schema(d1)` applies it. Reapplying is a no-op by
construction rather than by bookkeeping — there is no `__drizzle_migrations`
table in D1 and nothing to get out of step.

`src/db/schema.ts` is unchanged and remains the single definition the query
layer is built from; drizzle's `sqliteTable` works on both drivers. The two now
have to be kept in step by hand, which is the real cost of this decision — see
below.

## Consequences

- **The local libSQL migrations and the D1 DDL can drift.** Nothing generates
  one from the other. The workerd test asserts the D1 side against a hand-written
  list of the entity model's tables, so a *missing table* fails loudly; a column
  added to `schema.ts` and forgotten in `db/d1/` fails the first query that
  selects it. Adding a column is now a two-file change.
- **The migrations directory is legacy the day this lands.** It describes how
  the laptop database got where it is. Once the local path is deleted
  (CRUX-YALOJ9) it can go with it, and `db/d1/` becomes the only schema.
- **Transitions are testable against D1 without an account.** The pool's D1 is
  local and in-memory; the suite needs no network and no Cloudflare credentials,
  so it runs in CI unchanged.
- **Storage is shared between tests in a file.** `isolatedStorage` was removed in
  vitest-pool-workers 0.18; tests call `reset()` in `beforeEach` instead.
