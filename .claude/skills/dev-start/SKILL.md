---
name: dev-start
description: Onboarding flow for a new Crux checkout — clone, install, migrate, seed, run first command.
---

# Crux dev-start

Run these steps top-to-bottom on a fresh clone.

## 1. Install

```sh
bun install
```

Requires Bun ≥ 1.1.

## 2. Create + migrate the local database

Dev work is already pinned to a repo-local `.crux.db` — the committed `.env` sets `CRUX_DB_URL=file:.crux.db` so `bun run …` scripts never touch your user-level db, and `bin/crux` forces the same URL whenever it detects a `.git` checkout. Nothing to configure.

The libSQL file is gitignored; migrations are committed under `packages/core/src/db/migrations/`.

```sh
bun run generate   # only if migrations/ is empty or schema has changed
bun run migrate
```

This creates `.crux.db` at the repo root.

## 3. Seed WS-crux

```sh
bun run seed
```

Inserts the real WS-crux corpus (Workstream, Observations, Problem, Evidence, Solutions, Elimination, Decision). Idempotent — re-running against a seeded db is a no-op; it won't wipe your filings.

## 4. Write your user config

```sh
bun run crux user init --name "Your Name" --email "you@example.com"
```

Writes `$XDG_CONFIG_HOME/crux/config.toml` (falling back to `~/.config/crux/config.toml`) and inserts a matching User row.

## 5. Smoke-test context

```sh
bun run crux context -w crux --json | jq .
```

Expect PRB-thinking-residue-gap with its evidence, solutions, and DEC-001 inlined, plus `legal_next_transitions`.

## Troubleshooting

- `CRUX_DB_URL` env var overrides the database location.
- There is no reset script on purpose — destroying dogfooded state is a real failure mode we've hit. If you genuinely want a fresh db, delete `.crux.db` by hand, then `bun run migrate && bun run seed`.
- Transition errors carry a stable `code` string — grep `packages/core/src/transitions/errors.ts`.
