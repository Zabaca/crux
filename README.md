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
| **Observation** / **Idea** | Atomic intake. Cheap to create, never deleted.                                  |
| **Problem**                | Synthesized "there's a thing worth solving."                                    |
| **Evidence**               | Links an Observation to a Problem with a why-note.                              |
| **Solution**               | An option for a specific Problem.                                               |
| **Elimination**            | Rejects Solutions without committing to an alternative (progressive narrowing). |
| **Decision**               | Commits to a chosen Solution, records the losers.                               |
| **Abandonment**            | Graveyard for Problems we gave up on, with reason.                              |
| **Outcome**                | What shipping produced; closes the loop.                                        |
| **Theme**                  | Narrative grouping for roadmap views.                                           |

The entity model is the product. Workflow transitions — commit a Problem, create a Decision, eliminate a Solution, record an Outcome — are plain functions with invariant checks. You can't file a Decision against a chosen Solution. You can't eliminate a shipped one. You can't record an Outcome without a shipped Solution. The rules are code, not documentation.

## How it works

Claude Code is the primary surface. You discuss problems and solutions in conversation, and Claude files entries inline through the `crux` CLI at natural pause points — not as end-of-session ceremony. The CLI is optimized for Claude to run and parse: `--json` on every read command, structured errors with stable codes, meaningful exit codes.

To reload context into a fresh session:

```sh
crux context -w <workstream> --json
```

That emits a model-shaped digest: open Problems (sorted by priority), their Evidence with inlined Observations, Solutions with status, latest Decision, Eliminations, Abandonment, Outcomes, unpromoted Ideas, Themes. Drop it into a new conversation and Claude starts warm.

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
3. Database — runs `crux init` if `~/.local/share/crux/crux.db` doesn't exist (XDG-compliant user-level db).
4. User identity — prompts for your name/email, runs `crux user init`.

After that first run, all four checks are no-ops and the CLI is ready.

## Develop from source

For contributors working on Crux itself:

```sh
bun install
bun run generate       # if migrations/ is empty
bun run migrate        # creates .crux.db in the repo root
bun run seed           # no-op by default; populate scripts/seed-ws-crux.ts to seed your own corpus
bun run crux user init --name "Your Name" --email "you@example.com"
bun run crux context -w crux --json
```

Dev work is pinned to the repo-local `.crux.db` two ways so your real user-level db is never touched: a committed `.env` sets `CRUX_DB_URL=file:.crux.db` for `bun run …` scripts, and `bin/crux` detects a `.git` checkout and sets the same URL absolutely before forwarding to the CLI. Plugin consumers are unaffected — Bun only loads `.env` from their project's cwd, not from the plugin source.

There is no reset script. `bun run seed` is idempotent (it no-ops if WS-crux already exists). If you genuinely want a fresh db, delete `.crux.db` by hand — the friction is deliberate, because destroying dogfooded state is a real failure mode.

## Layout

- `.claude-plugin/` — plugin and marketplace manifests (this repo is itself a one-plugin marketplace).
- `skills/crux/` — the Crux skill that teaches Claude when and how to operate the CLI.
- `packages/core` — schema, transitions, validation, config loader.
- `packages/cli` — `crux` binary, command dispatch via citty.
- `scripts/` — seeding.
- `apps/` — reserved for a future web UI.

## Principles

- **Transitions are code, not documentation.** Invariants live as plain functions in `packages/core/src/transitions/`.
- **No stateful `crux use`.** Every command takes `-w <slug>` explicitly.
- **User identity in `$XDG_CONFIG_HOME/crux/config.toml`.** Not committed, not hardcoded.
- **libSQL file gitignored.** Migrations committed. Turso embedded replicas for team mode.
- **Status columns only where a human judgment is recorded.** Observation and Idea have no `status` — their state is derivable from related rows.
- **Claude is a tool, not an actor.** Attributions resolve to the human user.

## Status

MVP. Single-user local libSQL. No multi-tenant, no web UI, no test suite (transition logic is exercised end-to-end via the seed script). Design thinking for WS-crux itself is seeded in the db (`bun run seed`) and serves as the initial dogfood corpus.

See `.claude/skills/dev-start/SKILL.md` for new-machine onboarding.
