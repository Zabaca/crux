---
name: crux
description: Capture product-discovery thinking through the `crux` CLI as the conversation shapes it — Problems, Evidence, Solutions, Eliminations, Decisions — so the next session starts warm instead of cold. Use during discovery/design conversations; do not use for implementation-only work.
---

# Crux

Crux is a product-thinking residue tool. It captures the output of discovery conversations as typed state — Workstreams, Observations, Problems, Evidence, Solutions, Eliminations, Decisions, Outcomes — so future sessions can reload them via `crux context -w <slug> --json` instead of starting cold.

This skill tells you when to reach for `crux`, when not to, and how to use it well.

## How to invoke the CLI

Throughout this skill, `crux` refers to the plugin-bundled binary at `${CLAUDE_PLUGIN_ROOT}/bin/crux`. Always invoke the CLI via that explicit path — it's not on `$PATH`, and each Bash invocation in Claude Code spawns a fresh shell so aliases/env vars don't persist between calls.

```sh
${CLAUDE_PLUGIN_ROOT}/bin/crux context -w <slug> --json
```

The wrapper lazily runs `bun install` in the plugin dir on first use, so you don't need a separate deps check.

## When to invoke Crux

- The user articulates a claim, observation, or constraint worth remembering → `crux observation add`.
- The conversation is shaping a real problem-to-solve (who, why it matters, what's blocked) and the shape has settled enough to name → `crux problem add`.
- You or the user propose a concrete option for a Problem → `crux solution add`.
- A direction is ruled out even though no winner is picked → `crux elimination add`. Progressive narrowing is a real move.
- A direction is committed to → `crux decision add`. Rejected alternatives are named explicitly.
- A Problem stops being worth solving → `crux problem abandon --rationale "..."`.
- A shipped Solution's impact is known → `crux outcome add`.

## When NOT to invoke Crux

- The conversation is pure implementation or debugging — code goes in files, not in Crux.
- The user is venting, exploring, or thinking out loud and nothing has settled.
- You're tempted to file an entity you invented that wasn't grounded in the user's thinking.
- The item is a to-do or reminder. Crux isn't a task tracker.

Low-friction intake is a feature, but so is judgment. A blurry thought filed prematurely as a Problem creates drag on every later reload.

## First-run init

Before the first `crux` command in a session, run two checks and act only when something's missing. Deps are handled by the wrapper automatically — no separate check needed.

1. **Database**: `test -f ~/.local/share/crux/crux.db` — if missing, `${CLAUDE_PLUGIN_ROOT}/bin/crux init`.
2. **User config**: `test -f ~/.config/crux/config.toml` — if missing, ask the user for their name and email, then `${CLAUDE_PLUGIN_ROOT}/bin/crux user init --name "..." --email "..."`.

Both pass on steady state → no-op, near-zero latency. First run on a new machine hits them once.

## Load context before contributing

When the user names a workstream, run this _before_ adding new state:

```sh
crux context -w <slug> --json
```

Anchor on:

- `open_problems[]` — what's shaping vs committed, how much evidence each has.
- `open_problems[].latest_decision` — what's already been decided and why.
- `open_problems[].eliminations[]` — what's been ruled out; don't re-propose those.
- `unpromoted_ideas[]` — solution-space hunches still looking for a Problem.

If no workstream is in context and you can't infer one from the cwd, ask the user before inventing one.

## Propose-then-file, don't silently file

When you determine something should be filed, propose it in **prose** first — name the entity type, summarize the content, and call out the key fields (workstream, source-type, tags, priority, links to other entities). What the user reviews is the substance, not the shell syntax. Example:

> I'd file an **Observation** (external, tagged `dogfood,intake`) — *"GitHub issue #1: observations have no correction path..."* — and link it as **Evidence** to `observation-correction-gap` with note *"Direct reporter articulation of the gap."*

Do not lead with the CLI invocation. Flag-and-argument form buries the content under ceremony, especially when proposing multiple entities in one turn. Invoke the CLI yourself once the user approves.

Execute directly without pre-showing only when the user has explicitly authorized batch capture ("just file the observations from this conversation") or when you're resuming work the user already approved.

## Entity discipline

### Observation vs Idea

- **Observation** is problem-space — something noticed, grounded in a source (user report, metric, reading, internal experience).
- **Idea** is solution-space — a hunch before a matching Problem exists.

If the item comes from a source, it's an Observation. If it's a vague "what if we just…" floating without a Problem yet, it's an Idea.

### Evidence, not Problem redefinition

When an Observation supports an existing Problem, file `crux evidence link` rather than rewriting the Problem statement to absorb the new weight. Evidence preserves origin trail; Problem statements stay stable.

### Elimination vs Decision

- **Elimination** rejects one or more Solutions _without_ picking a winner. Use for progressive narrowing: "we've ruled out SaaS tools, still choosing between X and Y."
- **Decision** commits to a chosen Solution _and_ names rejected ones. Use when you're actually choosing.

A Decision where rejected Solutions aren't rows in the db is dishonest — it claims to have compared options that were never filed. Before filing a Decision, ensure every rejected alternative exists as a `proposed` Solution. If the user is about to commit to option A and options B, C haven't been recorded as Solutions, file them first.

### Abandonment is first-class

`crux problem abandon <slug> --rationale "..."` is a real event, not deletion. The rationale travels forward so future sessions don't re-derive the same dead end.

### Priority only when genuinely felt

`--priority P0|P1|P2|P3` is optional. Reserve **P0** for "this is blocking real work right now." Default to leaving it unset rather than ranking everything P1.

## Slugs and titles

- Workstream slug: kebab-case area name — `crux`, `farm-app`, `client-acme`.
- Problem slug: noun-phrase describing the gap — `thinking-residue-gap`, `onboarding-dropoff`. Not questions, not feature names.
- Solution slug: descriptive approach — `build-crux`, `notion-as-backend`. Not outcomes.
- Titles are one sentence. Descriptions are the paragraph.

## Attribution

`reporter_id` / `decided_by_id` / `eliminated_by_id` come from `~/.config/crux/config.toml`. If a command fails with "no user configured," run `crux user init`.

**You (Claude) are not a User.** Everything you file is attributed to the human whose machine ran the CLI. Preserve the distinction between "Claude found this" and "user observed this" in the _content_ of the entry — tags, phrasing — not in the reporter field.

## Reload mid-session

When a conversation runs long and branches into a new Problem area, consider re-running `crux context -w <slug> --json` before proposing entities in the new area. State can change between calls if other sessions are active.

## Cross-workstream audit

For the "where do my active engagements actually stand?" question, there's no single command yet — planned for a later iteration. For now, run `crux workstream list --json` and then `crux context` per workstream, or query the db directly.
