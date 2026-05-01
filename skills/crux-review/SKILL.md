---
name: crux-review
description: Synthesis pass over captured Crux state — walk unlinked Observations and unpromoted Ideas, link them as Evidence to existing Problems or shape new Problems, and file Solutions, Eliminations, Decisions, and Outcomes. Use when the user explicitly opens a review (e.g. /crux:review, "let's review what we've captured", "promote that into a problem", "let's commit a decision"). Default intake stays in /crux.
---

# Crux — review / synthesis mode

Default `/crux` is intake-only: cheap capture of Observations and Ideas during conversation. This skill is the **synthesis pass** — the deliberate work of turning that intake into structured Problems, Solutions, and Decisions.

Run this when the user has signaled they're ready to review accumulated state and shape it. Don't run it inline with intake.

## How to invoke the CLI

`crux` refers to `${CLAUDE_PLUGIN_ROOT}/bin/crux`. Use the explicit path; not on `$PATH`.

```sh
${CLAUDE_PLUGIN_ROOT}/bin/crux context -w <slug> --json --all
```

If first-run init hasn't happened this session (Bun, deps, db, config, team, web UI), run the init steps from the `/crux` skill first, then come back here.

## Always reload context first

Synthesis without fresh context produces drift. Run before the first action:

```sh
crux context -w <slug> --json --all
```

Anchor on:

- `recent_observations_unlinked[]` — primary review queue. Each one is a candidate for either Evidence-linking to an existing Problem or seeding a new Problem.
- `unpromoted_ideas[]` — solution-space hunches waiting for a Problem to attach to. Either link (via Solution + Problem), archive, or leave.
- `now[]`, `next[]`, `later[]`, `unscheduled[]` — open Problems by tier, with evidence counts and latest decisions. Use to find link targets.
- `[].latest_decision`, `[].eliminations[]` — what's already been decided / ruled out. Don't re-propose ruled-out directions.
- `done[]`, `abandoned[]` — closed Problems; scan for relevant prior decisions before filing new work.

If no workstream is named and you can't infer one from cwd, ask.

## Review loop

For each item in `recent_observations_unlinked` and `unpromoted_ideas`, propose one of:

1. **Link as Evidence** to an existing Problem — `crux evidence link <obs-id> --problem <slug> --note "why this supports it"`. Preferred when fit is clear.
2. **Promote to a new Problem** — file `crux problem add` (with the seed Observation linked as Evidence in the same review).
3. **Archive** — terminal. `crux observation archive` / `crux idea archive` with a rationale. Use for misfiles, duplicates, evaporated relevance.
4. **Leave** — explicitly defer. Keep the row; no action this pass.

Walk in batches. Propose-then-file: state the entity, content, fields, and links in prose; act after user approves. Don't lead with shell syntax.

## Propose-then-file, don't silently file

When proposing a synthesis move, write it as prose with the entity type, fields, and links called out. Example:

> I'd promote observation `obs-42` to a new **Problem** `evidence-link-friction` (P2) — _"Linking observations as evidence requires three flags and is the highest-friction step in review."_ — and link `obs-42` as the seed **Evidence** with note _"Original capture that articulated the friction."_

Invoke the CLI once the user approves. Skip the preview only when user authorizes batch operation.

## Entity discipline

### Evidence, not Problem redefinition

When an Observation supports an existing Problem, file `crux evidence link` rather than rewriting the Problem statement to absorb the new weight. Evidence preserves origin trail; Problem statements stay stable.

### Elimination vs Decision

- **Elimination** rejects one or more Solutions _without_ picking a winner. Progressive narrowing: "ruled out SaaS tools, still choosing X vs Y."
- **Decision** commits to a chosen Solution _and_ names rejected ones.

A Decision where rejected Solutions aren't rows in the db is dishonest — claims comparison that never happened. Before filing a Decision, ensure every rejected alternative exists as a `proposed` Solution. If user is about to commit to A and B/C aren't recorded, file them first.

### Abandonment is first-class

`crux problem abandon <slug> --rationale "..."` is a real event, not deletion. Rationale travels forward so future sessions don't re-derive the dead end.

### Scheduling is intentional

Problems start unscheduled (null status). `crux problem schedule <slug> --tier now|next|later` only when user has expressed genuine intent. `now` = actively in flight, `next` = queued, `later` = acknowledged but not soon. Leave unscheduled rather than guess.

### Outcome closes the loop

When a shipped Solution's impact is known, `crux outcome add` records what shipping produced. Required for closing a Problem to `done`.

## Slugs and titles

- Problem slug: noun-phrase describing the gap — `thinking-residue-gap`, `onboarding-dropoff`. Not questions, not feature names.
- Solution slug: descriptive approach — `build-crux`, `notion-as-backend`. Not outcomes.
- Titles are one sentence. Descriptions are the paragraph.

## Priority only when genuinely felt

`--priority P0|P1|P2|P3` is optional. Reserve **P0** for "blocking real work right now." Default unset rather than ranking everything P1.

## Attribution

`reporter_id` / `decided_by_id` / `eliminated_by_id` come from `~/.config/crux/config.toml`. Claude is not a User — attribution always resolves to the human.

## Reload mid-review

If review runs long and the user adds new intake or another session writes, re-run `crux context -w <slug> --json --all` before continuing. State drifts.

## View control bus

Drive web UI / TUI focus during review so the user sees what you're working on:

```sh
crux view send OPEN_PROBLEM '{"slug":"agent-view-bidirectional-sync"}' --json
crux view next --json | jq '.events[].type'   # check legal events first
```

Always use `crux view send`; never edit `view-state.json` directly.

**Data mutations do not push to surfaces.** When you file evidence, problems, decisions, the open web UI won't auto-refresh — user must reload. Navigation does update live.

## Hand back to intake

When review is done and conversation returns to capturing fresh thoughts, the default `/crux` skill applies again. No explicit handoff needed beyond not invoking review verbs.
