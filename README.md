# Crux

Structured residue layer for product-discovery thinking done in Claude Code conversations. Bun + TypeScript + libSQL.

## Quickstart

```sh
bun install
bun run generate      # if migrations/ is empty
bun run migrate       # creates .crux.db
bun run seed          # seeds WS-crux
bun run crux user init --name "Your Name" --email "you@example.com"
bun run crux context -w crux --json
```

## Layout

- `packages/core` — schema, transitions, validation, config loader.
- `packages/cli` — `crux` binary, command dispatch.
- `packages/skill` — thin SKILL.md for Claude sessions.
- `scripts/` — seeding and reset.
- `apps/` — reserved for a future web UI.

## Principles

- Transitions are plain functions in `packages/core/src/transitions/`.
- No stateful `crux use`; every command takes `-w <slug>`.
- User identity lives in `$XDG_CONFIG_HOME/crux/config.toml`.
- libSQL file is gitignored; migrations are committed.
- `Observation` and `Idea` have no `status` column — archived_at flag plus related-row existence queries replace it.

See `.claude/skills/dev-start/SKILL.md` for the new-machine onboarding flow.
