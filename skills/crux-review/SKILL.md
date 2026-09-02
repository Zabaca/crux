---
name: crux-review
description: Synthesis pass over captured Crux state — walk unlinked Observations, link them as Evidence to existing Problems or shape new Problems. Use when the user explicitly opens a review (e.g. /crux:review, "let's review what we've captured", "promote that into a problem", "let's record what became of that"). Default intake stays in /crux.
---

# Crux — review / synthesis mode

Default `/crux` is intake-only: cheap capture of Observations during conversation. This skill is the **synthesis pass** — the deliberate work of turning that intake into structured Problems, and of recording what became of them.

Run this when the user has signaled they're ready to review accumulated state and shape it. Don't run it inline with intake.

## How to invoke the CLI

`crux` refers to `${CLAUDE_PLUGIN_ROOT}/bin/crux`. Use the explicit path; not on `$PATH`.

```sh
${CLAUDE_PLUGIN_ROOT}/bin/crux context --all
```

**JSON is the default output format** — no `--json` flag needed. The `--json` flag is a deprecated no-op alias.

If first-run init hasn't happened this session (Bun, deps, db, config, team, web UI), run the init steps from the `/crux` skill first, then come back here.

## Always reload context first

Synthesis without fresh context produces drift. Run before the first action:

```sh
crux context --all
```

Anchor on:

- `recent_observations_unlinked[]` — primary review queue. Each one is a candidate for either Evidence-linking to an existing Problem or seeding a new Problem.
- `now[]`, `next[]`, `later[]`, `unscheduled[]` — open Problems by stage, with their Evidence and Attempts. Use to find link targets.
- `[].attempts[]` — work already in flight or already tried, each with the `closing_note` saying why it ended that way. Don't re-propose a direction that was dropped for a reason still standing.
- `done[]`, `abandoned[]` — closed Problems, each carrying the Outcome or the Abandonment rationale that closed it. Scan before filing new work.

If no workstream is named and you can't infer one from cwd, ask.

## Review loop

For each item in `recent_observations_unlinked`, propose one of:

1. **Link as Evidence** to an existing Problem — `crux evidence link <obs-id> --problem <id> --note "why this supports it"`. Preferred when fit is clear.
2. **Promote to a new Problem** — file `crux problem add` (with the seed Observation linked as Evidence in the same review).
3. **Archive** — terminal. `crux observation archive` with a rationale. Use for misfiles, duplicates, evaporated relevance.
4. **Leave** — explicitly defer. Keep the row; no action this pass.

Walk in batches. Propose-then-file: state the entity, content, fields, and links in prose; act after user approves. Don't lead with shell syntax.

## Propose-then-file, don't silently file

When proposing a synthesis move, write it as prose with the entity type, fields, and links called out. Example:

> I'd promote observation `obs-42` to a new **Problem** `evidence-link-friction` (P2) — _"Linking observations as evidence requires three flags and is the highest-friction step in review."_ — and link `obs-42` as the seed **Evidence** with note _"Original capture that articulated the friction."_

Invoke the CLI once the user approves. Skip the preview only when user authorizes batch operation.

## Entity discipline

### Evidence, not Problem redefinition

When an Observation supports an existing Problem, file `crux evidence link` rather than rewriting the Problem statement to absorb the new weight. Evidence preserves origin trail; Problem statements stay stable.

### An Attempt is a pointer, not a copy

Crux does not own the build (ADR-0012). When work about a Problem starts
somewhere else, record it as an Attempt — `crux attempt add --problem <id> --ref
<url-or-key> --label "..."` — and nothing more: there is no description field,
because what the work *is* lives in the linked system and a second copy rots.

On close, `--note` is the load-bearing half: *why* the approach ended the way it
did. The tracker says "won't do"; it never says the approach could not handle
the load. A `shipped` Attempt does not complete the Problem — that is a separate
judgment, recorded as an Outcome.

### Abandonment is first-class

`crux problem abandon <id> --rationale "..."` is a real event, not deletion. Rationale travels forward so future sessions don't re-derive the dead end.

### Scheduling is intentional

Problems start unscheduled (null status). `crux problem schedule <id> --stage now|next|later` only when user has expressed genuine intent. `now` = actively in flight, `next` = queued, `later` = acknowledged but not soon. Leave unscheduled rather than guess.

### Outcome closes the loop

When what became of a Problem is known, `crux outcome add --problem <id>` records it. Recording one is what closes the Problem to `done`; there is no other way.

## Titles

- Titles are one sentence. Descriptions are the paragraph.
- Problem title: noun-phrase describing the gap — "Thinking residue gap", "Onboarding dropoff". Not questions, not feature names.
- Attempt label: the approach being tried — "Build crux", "Notion as backend". Not outcomes.

## Priority only when genuinely felt

`--priority P0|P1|P2|P3` is optional. Reserve **P0** for "blocking real work right now." Default unset rather than ranking everything P1.

## Attribution

`reporter_id` / `created_by_id` / `recorded_by_id` come from `~/.config/crux/config.toml`. Claude is not a User — attribution always resolves to the human.

## Reload mid-review

If review runs long and the user adds new intake or another session writes, re-run `crux context --json --all` before continuing. State drifts.

## View control bus

Drive web UI / TUI focus during review so the user sees what you're working on:

```sh
crux view send OPEN_PROBLEM --payload '{"id":"42"}' --json
crux view next --json | jq '.events[].type'   # check legal events first
```

Always use `crux view send`; never edit `view-state.json` directly.

**Data mutations do not push to surfaces.** When you file Evidence, Problems or Attempts, the open web UI won't auto-refresh — user must reload. Navigation does update live.

## Hand back to intake

When review is done and conversation returns to capturing fresh thoughts, the default `/crux` skill applies again. No explicit handoff needed beyond not invoking review verbs.
