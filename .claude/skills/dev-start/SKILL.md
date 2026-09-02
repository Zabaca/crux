---
name: dev-start
description: Onboarding flow for a new Crux checkout — clone, install, point at a deployment, run first command.
---

# Crux dev-start

Run these steps top-to-bottom on a fresh clone.

## 1. Install

```sh
bun install
```

Requires Bun ≥ 1.1.

## 2. Point the CLI at a deployment

There is no local database. Every command talks to a crux deployment over HTTP,
so what a fresh checkout needs is a URL and the bearer token minted for you:

```sh
bun run crux init --url https://<your-deployment> --token <token>
```

That checks the coordinates work before writing `[api]` into `config.toml`.
`CRUX_API_URL` / `CRUX_API_TOKEN` override the file for one invocation.

To work against a throwaway corpus instead of the real one, run the Worker
locally — its D1 binding is a local file — and point the CLI at it:

```sh
cd apps/cloud && bunx wrangler dev     # then: export CRUX_API_URL=http://localhost:8787
```

## 3. Seed (optional)

`scripts/seed-ws-crux.ts` is empty in the public repo and `bun run seed` is a no-op. Populate it with your own starter corpus if you want one — see the schema at `packages/core/src/db/schema.ts` and the transitions at `packages/core/src/transitions/` for shape and invariants.

## 4. Write your user config

```sh
bun run crux user init --name "Your Name" --email "you@example.com"
```

Writes the `[user]` section of `$CRUX_HOME/config.toml`. The `users` row itself belongs to the deployment — it is created when a Member is invited and a token minted, and the token is what identifies the actor on every request.

## 5. Smoke-test context

```sh
bun run crux context -w crux --json | jq .
```

Expect PRB-thinking-residue-gap with its evidence and attempts inlined, plus `legal_next_transitions`.

## Troubleshooting

- `CRUX_API_URL` / `CRUX_API_TOKEN` override the deployment for one invocation; `CRUX_HOME` moves `config.toml`.
- There is no reset command on purpose — destroying dogfooded state is a real failure mode we've hit. D1 has point-in-time restore if you need to undo something.
- Transition errors carry a stable `code` string — grep `packages/core/src/transitions/errors.ts`.
