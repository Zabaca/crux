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

## Workflow notes for skills

- Tickets move Backlog → Running → Review → Completed via deterministic
  signals; agents never move cards manually.
- "Ship / finish" means open a PR and move to Review — never merge.
- PRs as a request surface: **off**. Don't treat inbound PRs as work items.
