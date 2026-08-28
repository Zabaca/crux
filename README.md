# Crux

Structured residue for product discovery done in Claude Code conversations.

## Why it exists

Product discovery inside a chat session is high-quality in the moment and lost by morning. Each new conversation restarts cold. Decisions fade, rationale fades, and across parallel engagements there's no way to see which ones have a defined direction vs. which are drifting.

Run a few engagements through Claude Code and the problem compounds. The mental overhead of re-deriving context starts eating more time than the work, and "file another scattered doc" becomes the path of least resistance. That's a self-imposed cap on how many projects you can actually hold.

Crux is a structured residue layer: capture the output of a discovery conversation _as it happens_, reload it into future sessions as model-shaped context rather than prose to re-parse, and make parallel workstreams comparable so drift becomes visible.

## What it is

A typed entity model with workflow invariants enforced in code, fronted by a CLI designed for Claude Code to operate.

| Entity                     | Role                                                                            |
| -------------------------- | ------------------------------------------------------------------------------- |
| **Workstream**             | A coherent area of focus (per client, per product).                             |
| **Observation**            | Atomic intake. Cheap to create, never deleted.                                  |
| **Problem**                | Synthesized "there's a thing worth solving."                                    |
| **Evidence**               | Links an Observation to a Problem with a why-note.                              |
| **Solution**               | An option for a specific Problem.                                               |
| **Elimination**            | Rejects Solutions without committing to an alternative (progressive narrowing). |
| **Decision**               | Commits to a chosen Solution, records the losers.                               |
| **Abandonment**            | Graveyard for Problems we gave up on, with reason.                              |
| **Outcome**                | What shipping produced; closes the loop.                                        |

The entity model is the product. Workflow transitions — commit a Problem, create a Decision, eliminate a Solution, record an Outcome — are plain functions with invariant checks. You can't file a Decision against a chosen Solution. You can't eliminate a shipped one. You can't record an Outcome without a shipped Solution. The rules are code, not documentation.

## How it works

Claude Code is the primary surface. You discuss problems and solutions in conversation, and Claude files entries inline through the `crux` CLI at natural pause points — not as end-of-session ceremony. The CLI is optimized for Claude to run and parse: `--json` on every read command, structured errors with stable codes, meaningful exit codes.

To reload context into a fresh session:

```sh
crux context -w <workstream> --json
```

That emits a model-shaped digest: open Problems (sorted by priority), their Evidence with inlined Observations, Solutions with status, latest Decision, Eliminations, Abandonment, Outcomes. Drop it into a new conversation and Claude starts warm.

For cross-project audit, `crux` queries across all workstreams in the same shape — the answer to "where do my active engagements actually stand?" is one command, not a doc hunt.

## Install (Claude Code plugin)

The intended way to adopt Crux is as a Claude Code plugin. One command adds the skill, slash commands, and CLI to every session:

```
/plugin marketplace add Zabaca/crux
/plugin install crux
```

First time you use it in a conversation, Claude walks you through four checks and only acts on what's missing:

1. Bun runtime — `command -v bun`. Crux runs on Bun. If it's not installed, Claude surfaces the install command for your platform (`curl -fsSL https://bun.sh/install | bash` works on macOS and Linux; `brew install oven-sh/bun/bun` on Homebrew; PowerShell one-liner on Windows). After install, restart your shell so the new PATH takes effect.
2. Plugin deps — runs `bun install` in the plugin dir if `node_modules` is absent.
3. Deployment — runs `crux init --url <deployment> --token <token>` if `[api]` is missing from `config.toml`. The corpus lives in the cloud (ADR-0003); this is what points your machine at it.
4. User identity — prompts for your name/email, runs `crux user init`.

After that first run, all four checks are no-ops and the CLI is ready.

## The client-server split

There is no local database. Every `crux` command is an HTTP call to the
deployment ([ADR-0003](docs/adr/0003-cloud-crux-client-server.md)): reads go to
`POST /v1/query` as a *named* read, writes to `POST /v1/dispatch` as an action,
and view-state lives in a per-user Durable Object behind `/v1/view`. Both
entry points are in core — `query()` beside `dispatch()` — so an invariant and a
`--json` shape each exist in exactly one place, which is the only arrangement
that survives two people writing at once.

What the CLI still owns is argument parsing, the request it sends, and the
terminal: the server's `{error:{code,message,details}}` envelope is rebuilt into
the same error objects as before, so codes and exit codes are unchanged.

`crux init` writes `[api] url` / `token` into `config.toml` after checking they
work. `CRUX_API_URL` and `CRUX_API_TOKEN` override the file for one invocation.

## Develop from source

For contributors working on Crux itself:

```sh
bun install
bun run crux user init --name "Your Name" --email "you@example.com"
bun run crux init --url https://<your-deployment> --token <token>
bun run crux context -w crux --json
```

`bun run build` derives the doc tree and runs `astro build`; `bun run test`
does it for you, because the workerd suites run against the built bundle
([ADR-0009](docs/adr/0009-astro-wraps-the-worker-entry.md)).

The cloud schema is end-state DDL applied by `applyD1Schema`
([ADR-0006](docs/adr/0006-workerd-tests-and-d1-schema.md)) — there is no
migrations directory and no drizzle-kit. To develop against a throwaway corpus
rather than the real one, run the Worker locally (`cd apps/cloud && bunx wrangler dev`),
whose D1 binding is a local file, and point `CRUX_API_URL` at it.

## Deploy (cloud crux)

Cloud crux is one Cloudflare Worker with a D1 database, deployed through
[zbc](https://github.com/Zabaca/zbc) ([ADR-0004](docs/adr/0004-cloudflare-stack.md)).
Production only — there is no preview environment.

**Merging to `main` deploys.** [`production.yml`](.github/workflows/production.yml)
runs lint, typecheck, `docs:check` and the suite, then `zbc apply production`.
The same command works from an operator's machine:

```sh
bun run deploy          # bunx @zabaca/zbc apply production
```

`zbc apply` converges the database *and* the code: the
[`d1`](packages/infra/environments/production/d1.ts) instance applies the schema
first, and the [`cloud`](packages/infra/environments/production/cloud.ts)
instance — which imports it — then deploys the Worker that reads it. Deploying
code ahead of its schema is how a Worker ends up 500ing on a column that does
not exist yet, so that ordering is enforced by the import, not by convention.

**Never run zbc with `bunx --bun`.** zbc shells out to wrangler, and wrangler on
the Bun runtime exits 0 after uploading a version while silently skipping the
deploy. zbc's cloudflare module catches that — it fails unless wrangler prints
its `Deployed … triggers` confirmation — but the clean path is to let `bunx` pick
the Node runtime, which `bun run deploy` does.

- [`apps/cloud`](apps/cloud) is the Worker. Its topology lives in
  [`wrangler.jsonc`](apps/cloud/wrangler.jsonc), which is the source of truth for
  it — including the D1 binding. `zbc` builds first and then deploys from
  `apps/cloud`; `astro build` writes the resolved copy of that config into
  `dist/server` along with a redirect wrangler follows
  ([ADR-0009](docs/adr/0009-astro-wraps-the-worker-entry.md)).
- [`packages/infra/environments/production/cloud.ts`](packages/infra/environments/production/cloud.ts)
  is the zbc instance: which package to deploy, into which account.
- [`packages/infra/environments/production/d1.ts`](packages/infra/environments/production/d1.ts)
  is the database: it adopts `crux-production` by name and applies the same
  `D1_SCHEMA_STATEMENTS` the Worker and the workerd tests use, so a table added
  to the schema module reaches production without a second edit.
- `CLOUDFLARE_API_TOKEN`, `BETTER_AUTH_SECRET` and `RESEND_API_KEY` live SOPS/age-encrypted in
  [`secrets.yaml`](packages/infra/environments/production/secrets.yaml); the
  recipients are listed in [`.sops.yaml`](.sops.yaml) — two operator machines
  and CI, whose private half is the `SOPS_AGE_KEY` Actions secret. To add a
  machine, add its age public key there and run
  `sops updatekeys packages/infra/environments/production/secrets.yaml` from a
  machine that is already a recipient.

The Worker needs two secrets, both carried by `zbc apply` out of `secrets.yaml`:
`BETTER_AUTH_SECRET` signs browser sessions, and `RESEND_API_KEY` sends the
sign-in links that are the only way to get one ([ADR-0010](docs/adr/0010-sign-in-is-a-magic-link.md)).
`EMAIL_FROM` goes with the latter and is a plain var in `wrangler.jsonc`, since
the address a mail comes from is public the moment one is sent; it must be on a
domain the Resend account has verified. Missing any of them leaves `/health`,
the `/v1` API and the CLI working and turns off only the browser surfaces, which
say which one is missing. `CRUX_WORKSPACE_NAME` optionally names the Workspace
in the header; it defaults to the deployment's host.

The first Member is a chicken-and-egg case, and is still open. Signing in mails
a link to any address that already has a `users` row, and an invite is what
creates a row — but invites are issued by a Member, so a deployment with no
rows at all has no way in that does not involve writing one into D1 by hand.
`crux user init` does **not** close this: it writes local config and makes no
request to the deployment.

`GET /health` is the deployment's liveness check. It round-trips the D1 binding
rather than answering from memory, so a Worker that cannot read its corpus
reports `503 degraded` instead of a hollow `ok`.

## Layout

- [`.claude-plugin/`](.claude-plugin/) — plugin and marketplace manifests (this repo is itself a one-plugin marketplace).
- [`skills/crux/`](skills/crux/) — the Crux skill that teaches Claude when and how to operate the CLI.
- [`packages/core`](packages/core) — schema, transitions, `dispatch()` and `query()`, validation, config loader.
- [`packages/cli`](packages/cli) — `crux` binary, command dispatch via citty, and the HTTP client every command goes through.
- [`packages/infra`](packages/infra) — zbc module instances and encrypted secrets, per environment.
- [`scripts/`](scripts/) — seeding and the doc-tree rot check.
- [`apps/cloud`](apps/cloud) — the deployed Cloudflare Worker: `/health`, the `/v1` JSON API, the page templates under [`src/web/`](apps/cloud/src/web), the view-state Durable Object, and the Astro site (`astro/`) whose React islands are the board and the action dialogs.

## Docs

Documentation is whatever is reachable from this file: a walker starts here and
follows internal links and `@import`s ([ADR-0002](docs/adr/0002-readme-rooted-doc-tree.md)).
A doc that exists but isn't linked from the tree doesn't count — `bun run docs:check`
reports it as rot. The walker has two callers and no third implementation: that
check, and `scripts/build-docs.ts`, which runs it at build time so the deployment
can serve the tree at `/docs` without a working tree to read
([ADR-0005](docs/adr/0005-docs-derived-at-deploy.md)). Rot fails the build,
naming the broken links and orphans.

- [`CONTEXT.md`](CONTEXT.md) — the glossary. Canonical vocabulary for this repo.
- Decisions — [ADR-0001: single dual-audience doc](docs/adr/0001-single-dual-audience-doc.md),
  [ADR-0002: README-rooted doc tree](docs/adr/0002-readme-rooted-doc-tree.md),
  [ADR-0003: cloud crux is client-server and cloud-only](docs/adr/0003-cloud-crux-client-server.md),
  [ADR-0004: the Cloudflare stack](docs/adr/0004-cloudflare-stack.md),
  [ADR-0005: docs derived at deploy](docs/adr/0005-docs-derived-at-deploy.md),
  [ADR-0006: workerd tests and the D1 schema](docs/adr/0006-workerd-tests-and-d1-schema.md),
  [ADR-0007: one identity table, two front doors](docs/adr/0007-one-identity-table-two-front-doors.md),
  [ADR-0008: Astro lands with the write surfaces](docs/adr/0008-astro-lands-with-the-write-surfaces.md),
  [ADR-0009: Astro wraps the Worker entry](docs/adr/0009-astro-wraps-the-worker-entry.md),
  [ADR-0010: sign-in is a magic link](docs/adr/0010-sign-in-is-a-magic-link.md).
- Specs — [human-readable surface](docs/human-readable-surface-spec.md),
  [agent-driven view control](docs/agent-driven-view-control-spec.md).
- Notes — [Claude agent teams internals](docs/claude-agent-teams.md),
  [model selection](docs/model-selection.md).

## Principles

- **Transitions are code, not documentation.** Invariants live as plain functions in [`packages/core/src/transitions/`](packages/core/src/transitions/).
- **No stateful `crux use`.** Every command takes `-w <slug>` explicitly.
- **User identity in `$CRUX_HOME/config.toml` (`~/.claude/.crux/config.toml`).** Not committed, not hardcoded.
- **One corpus, reached over HTTP.** No local database, no replicas — the transition layer runs in exactly one place ([ADR-0003](docs/adr/0003-cloud-crux-client-server.md)).
- **Status columns only where a human judgment is recorded.** Observation has no `status` — its state is derivable from related rows.
- **Claude is a tool, not an actor.** Attributions resolve to the human user.

## Status

MVP. Single-tenant cloud deployment. In the browser: sign-in, inviting Members,
minting and revoking CLI tokens, pages for Problem, Solution and Observation,
the doc tree at `/docs`, and the write surfaces — a Workstream at `/w/<slug>`
that *is* a drag-and-drop roadmap board, and contextual action dialogs that file
entities and record transitions. The board shows all six Stages; the two
terminal ones, `done` and `abandoned`, are read-only there because they are
reached by a Decision or an Abandonment rather than by dragging. Every one of
those writes goes through `POST /v1/dispatch`, the CLI's endpoint, so there is
no browser-only path where an invariant could be skipped; a refused transition
shows its code and message rather than snapping the card back in silence. Live refresh is the ViewStateDO
push stream, so a `crux` command in a terminal lands on the open page.

The site is Astro with React islands, wrapping the hand-written Worker entry
rather than replacing it ([ADR-0009](docs/adr/0009-astro-wraps-the-worker-entry.md)).
Transitions, reads, token auth and every browser surface are tested inside
workerd against a real D1 and the built bundle
([ADR-0006](docs/adr/0006-workerd-tests-and-d1-schema.md)); the CLI is tested
against a stub deployment. `bun run test` builds, then runs both runners.

See [`.claude/skills/dev-start/SKILL.md`](.claude/skills/dev-start/SKILL.md) for new-machine onboarding.


---
name: karpathy-guidelines
description: Behavioral guidelines to reduce common LLM coding mistakes. Use when writing, reviewing, or refactoring code to avoid overcomplication, make surgical changes, surface assumptions, and define verifiable success criteria.
license: MIT
---

# Guidelines

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## Agent skills

### Issue tracker

Issues are Fredrin tickets, operated via the `fredrin` CLI (not GitHub issues). See [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md).

### Domain docs

Single-context: one [`CONTEXT.md`](CONTEXT.md) + [`docs/adr/`](docs/adr/) at the repo root. See [`docs/agents/domain.md`](docs/agents/domain.md).