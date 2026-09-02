# Runbook: rebuild the production database empty

Discard the corpus and start `crux-production` over as an empty database, then
put one identity back so the browser is reachable again.

**This destroys the deployment's data and there is no backup step below.** D1
keeps point-in-time recovery, so a rebuild is *recoverable* by Cloudflare for as
long as that window lasts, but nothing in this procedure captures a copy.

## When this is the right move

The cloud schema is an end state applied as purely additive DDL
([ADR-0006](../adr/0006-workerd-tests-and-d1-schema.md)): `CREATE TABLE IF NOT
EXISTS` plus a list of `ALTER TABLE … ADD COLUMN`. Two things that list cannot
express:

- **Removing** a table. Deleting it from `D1_SCHEMA_STATEMENTS` stops creating
  it on a fresh database and leaves it standing forever on an existing one.
- **Repointing** a column at a different parent. In SQLite that is a table
  rebuild, not an `ALTER`.

Both are free against an empty database, which is why the reshaping in
[ADR-0012](../adr/0012-crux-does-not-own-the-build.md) needs this runbook. It
does both kinds: `outcomes` now hangs off `problems` rather than the deleted
`solutions` table, so a deployment that has not been wiped keeps a table with
the old parent and answers every Outcome read and write with `no such column:
problem_id`; and the `solutions`, `eliminations`, `decisions` and their two join
tables are gone from the schema module, which does not drop them in a database
that already has them. If a change is purely additive, it does *not* need this
runbook — just deploy.

## Before you start

- You are an operator with a private age key listed in [`.sops.yaml`](../../.sops.yaml).
- `sops` and `bun` are on PATH.
- Everyone who uses the deployment knows the corpus is going away.

Export the deploy credential — the same secret `zbc apply` uses, which needs
Account → D1: Edit:

```sh
export CLOUDFLARE_API_TOKEN=$(sops -d packages/infra/environments/production/secrets.yaml \
  | grep '^CLOUDFLARE_API_TOKEN:' | cut -d' ' -f2)
```

## The procedure

### 1. Dry run

```sh
bun run db:wipe
```

Contacts nothing, names the database it would empty, and exits non-zero. This is
the default: the wipe only happens when you type the database's own name.

### 2. Wipe

```sh
bun run db:wipe --confirm crux-production
```

Every table, view, index and trigger is dropped —
[`dropAll`](../../packages/core/src/db/d1/rebuild.ts) enumerates `sqlite_master`
rather than replaying the schema module, so tables that were removed from the
code in an earlier release go too. Foreign keys make the order matter, so it
drops in repeated passes and fails loudly, naming the survivors, rather than
reporting an empty database that is not. SQLite's and D1's own tables
(`sqlite_%`, `_cf_%`, `d1_%`) are left alone.

From here until step 3 the deployment has a Worker with no tables under it:
every read 500s. `/health` keeps saying `ok`, because it round-trips the
binding rather than the schema — which is why step 4 does not stop there.

If the wipe dies part-way through, re-run the same command. Every drop is
`IF EXISTS` and the object list is re-read from `sqlite_master` on each run, so
finishing a half-done wipe is the same command as starting one.

### 3. Deploy

```sh
bun run deploy
```

One command converges both halves and there is no manual schema step after it:
[`cloud.ts`](../../packages/infra/environments/production/cloud.ts) imports
[`d1.ts`](../../packages/infra/environments/production/d1.ts), so zbc applies
`D1_SCHEMA_STATEMENTS` to the empty database *before* deploying the Worker that
reads it. Merging to `main` runs the same command from CI — but only on a push,
so after a wipe the recovery is this one from an operator's machine, not a
button in Actions.

### 4. Check it

```sh
curl -s https://<deployment>/health
```

`{"status":"ok","db":"ok"}` says the Worker can reach a D1 database. It does
*not* say the schema is back: that route runs `select 1`, which an empty
database answers perfectly well. A `503 degraded` means D1 was unreachable —
after a wipe the likeliest cause is the binding id in
[`wrangler.jsonc`](../../apps/cloud/wrangler.jsonc), though the wipe drops
tables and never deletes the database, so it should still match.

For the schema itself, ask the database what it has:

```sh
bunx wrangler d1 execute crux-production --remote \
  --command "select count(*) as tables from sqlite_master where type = 'table'"
```

Eighteen tables, as of this writing, and `users` empty. Zero means the deploy
did not apply the schema — read the `zbc apply` output again before going on.

### 5. Restore one identity

An empty `users` table has no way back in: signing in mails a link only to an
address that already has a row ([ADR-0010](../adr/0010-sign-in-is-a-magic-link.md)),
and rows are created by redeeming an invite, which only a Member can issue. So
the first one goes in by hand:

```sh
bun run db:restore-identity --email you@example.com --name "Your Name"          # dry run
bun run db:restore-identity --email you@example.com --name "Your Name" \
  --confirm crux-production
```

That writes what redeeming an invite writes — a verified address, a slug made
unique against the table, no removal stamp — and nothing else. An address that
already has a row is reported, not overwritten: everything that person authored
cites their id, so reusing the row is the point, and lifting a *removal* is a
job for an invite rather than for this. Sign in at the deployment with
that address, then invite everyone else and mint a CLI token from the browser
the usual way; `crux init --url … --token …` points a machine at it again.

This step is the chicken-and-egg case the README names, and it goes away when
Principals land ([ADR-0013](../adr/0013-anonymous-first-adoption.md)): first use
will mint a Principal without an invite, and there will be nothing to restore.

## Afterwards

- **CLI tokens are gone.** Every `api_tokens` row went with the wipe, so every
  machine gets `crux init` again with a freshly minted token.
- **Browser sessions are gone.** `auth_sessions` went too; everyone signs in again.
- **View-state is not in D1.** It lives in a Durable Object keyed by user id, so
  a restored identity — which gets a new id — starts with an empty view rather
  than a stale one. The old DOs are orphaned and harmless.
