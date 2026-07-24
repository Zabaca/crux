# The invariant suite runs in workerd, on Vitest with the Workers pool

Core's invariant suite executes inside workerd against a local Miniflare D1,
driven by Vitest with `@cloudflare/vitest-pool-workers`
(`bun run test:workers`). It needs no network and no Cloudflare account. The
rest of the repo — the docs walker, the view-state machine, the CLI — stays on
`bun test`, which owns everything that touches the filesystem or spawns a
process. Two runners, split by runtime rather than by taste.

We chose this over driving Miniflare programmatically from `bun test`, which
would have kept one runner. That option runs *the database* in workerd but the
code under test in Bun, so it proves the SQL works and nothing about whether
the transition layer can run in a Worker at all. Since the whole point of
[ADR-0003](0003-cloud-crux-client-server.md) is that the transition layer lives
in exactly one place — the Worker — testing it anywhere else tests the wrong
thing. The pool also gives per-test D1 isolation and the real `env` binding,
both of which we would otherwise hand-roll.

## What the runtime forced

The rules are unchanged; the driver moved out from under them.

- **`db.transaction()` is gone.** D1 rejects `BEGIN` and `SAVEPOINT`, so every
  transition that wrote more than one row now assembles its statements and hands
  them to `atomically()`, a thin wrapper over `batch()` — one implicit
  transaction, all-or-nothing. Every transition already wrote without reading
  mid-transaction, which is exactly what batch supports.
- **Foreign keys are enforced statement by statement inside a batch**, and D1
  will not let a migration turn them off. `renameWorkstream` moves a primary
  key, so it now runs copy → repoint → drop: the new Workstream row exists
  before anything points at it, the old one goes away once nothing does. No
  intermediate state violates a constraint, which is a stronger guarantee than
  the `PRAGMA foreign_keys = OFF` dance it replaces.
- **D1 gets its own migration chain**, `packages/core/src/db/migrations-d1/`,
  baselined from `schema.ts` (`bun run generate:d1`). The single-machine libSQL
  history cannot be replayed on D1 — it disables foreign keys and builds temp
  tables, both refused by D1's authorizer — and replaying it would be pointless
  anyway: it exists to carry one local file forward, and a D1 database starts
  empty. `schema.ts` is untouched and shared, as
  [ADR-0004](0004-cloudflare-stack.md) intended.

## Consequences

- **The D1 baseline is more faithful to `schema.ts` than the libSQL chain is.**
  Replaying the old migrations produces tables with no foreign keys and no
  column defaults — the table rebuilds in `0005` dropped them. Anything written
  against the local database has therefore never had referential integrity
  enforced; on D1 it does. Expect writes that quietly worked locally to fail in
  the cloud, which is the point.
- **Two migration folders until the local path is removed.** A schema
  change means running both `bun run generate` and `bun run generate:d1`.
- **A test that reads a file or spawns a process cannot move into the workers
  suite.** `dispatch()` itself still persists view-state through `node:fs` and
  resolves identity from `~/.claude/.crux/config.toml`, so only its pure half —
  action schemas and the allowed-list — runs in workerd today. The rest follows
  the view-state Durable Object and session identity.
- **`getDb()` no longer self-initializes.** A D1 binding only exists inside a
  request, so callers bind one first: the Worker will `setDb(createD1Db(env.DB))`
  per request, and the CLI calls `bindLocalDb()` at startup.
