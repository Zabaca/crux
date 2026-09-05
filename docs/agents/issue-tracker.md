# Issue Tracker

Issues for this repo are tracked as **Fredrin tickets** — the Fredrin desktop
kanban this project runs inside. Tickets are NOT GitHub issues; do not use
`gh issue` unless the user explicitly says "GitHub issue".

## How to operate it

Use the `fredrin` CLI (on `$PATH` in every Fredrin terminal; all output is JSON,
strictly noun-verb):

- **Create an issue:** `fredrin tickets create '{"title":"…","description":"…"}'`
  — lands in the Backlog column. For multi-ticket batches, follow the mandatory
  dependency-graph protocol in `.fredrin/FREDRIN.md` (create prerequisites
  first, pass `"dependsOn":[…]`, verify `dependsOnResults`).
- **List issues:** `fredrin tickets list`
- **Read one issue:** `fredrin tickets get <ticketId|identifier>`
- **Group related issues:** `fredrin goals create` + `fredrin goals assign`
  (always give the goal a `description`).

Inside a ticket worktree, the per-ticket `./.fredrin/fredrin` CLI also exists
(`ticket get`, `ticket finish`, …) — see `.fredrin/FREDRIN.md`, which is the
authoritative reference for the full workflow, board columns, and
disambiguation rules.

## What the board says, and what it does not

- **A ticket on the board is ready.** Landing in Backlog *is* the agent-grabbable
  state, so there is no triage step and no `ready-for-agent` label. Skills that
  assume a triage vocabulary — `to-spec`, `to-tickets` — say it "should have been
  provided to you"; this file is what provides it, and the answer is that there is
  nothing to apply. Fredrin has no label vocabulary to reach for either: no `labels`
  verb, no labels endpoint, and `tickets update` accepts only opaque `labelIds`.
  Those skills stay unedited on purpose — they are vendored upstream and a second
  copy of this rule is the one that rots.
- **A spec becomes a Goal plus its tickets, and the Goal's `description` is the
  spec.** Create the Goal first and never name-only: the description is its plan, it
  renders on the board, and it is where the shape of the work lives — what is being
  built, why the tickets are cut where they are, and what is deliberately out of
  scope. Do not also write a spec document; the argument behind the work belongs in
  an ADR, the shape of it in the Goal, and the slices in the tickets, each in one
  place. Then create one ticket per slice in dependency order, passing
  `"dependsOn":[…]` so each lands blocked by its prerequisites, and read
  `dependsOnResults` on each create rather than assuming the edge landed.
  `fredrin goals assign <goal> <ticket…>` is what files them under the goal; without
  it they are not in it. The authoritative version of this, including ship-together,
  is `.fredrin/FREDRIN.md`.

## Workflow notes for skills

- Tickets move Backlog → Running → Review → Completed via deterministic
  signals; agents never move cards manually.
- "Ship / finish" means open a PR and move to Review — never merge.
- PRs as a request surface: **off**. Don't treat inbound PRs as work items.
