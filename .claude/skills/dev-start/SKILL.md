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

## 2. Point dev at a repo-local db

By default Crux writes to `file:$XDG_DATA_HOME/crux/crux.db` (user-level, so plugin installs Just Work). For in-repo development you want a repo-local db instead so dev experiments don't pollute your user db:

```sh
cp .env.example .env   # sets CRUX_DB_URL=file:.crux.db
```

Bun auto-loads `.env` for `bun run …`, so every subsequent script picks it up.

## 3. Create + migrate the local database

The libSQL file is gitignored; migrations are committed under `packages/core/src/db/migrations/`.

```sh
bun run generate   # only if migrations/ is empty or schema has changed
bun run migrate
```

This creates `.crux.db` at the repo root (per `.env`).

## 3. Seed WS-crux

```sh
bun run seed
```

Inserts the real WS-crux corpus (Workstream, Observations, Problem, Evidence, Solutions, Elimination, Decision). Structural integrity only — prose is placeholder; the source doc is authoritative.

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
- `bun run reset` drops the local db and re-runs migrate + seed.
- Transition errors carry a stable `code` string — grep `packages/core/src/transitions/errors.ts`.
