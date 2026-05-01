# Human-readable surface — spec

This doc is the authoritative spec for two parallel implementations of a human-browseable view of Crux state: a Next.js web UI under `apps/web/` and an ink-based TUI under `packages/cli/src/commands/browse.ts`. Both ship in this repo and are read-only for v1.

## Why

`crux context -w <slug> --json` is shaped for Claude to reload, not for a human to scan. Today the only ways to inspect a workstream are (a) ask Claude in conversation or (b) pipe CLI output through `jq`. Filed in-db as `PRB-human-readable-surface-gap` (P2). This spec exists so two agents can build different surfaces toward the same target behavior without drifting.

## User stories

Each is "as a maintainer" unless noted; "open" means "navigate to / drill into."

1. **Workstream overview.** I can see all workstreams in one list with their slug, title, and a glance-count of open Problems.
2. **Workstream dashboard.** I can open a workstream and see its open Problems sorted by priority (P0→P3, then null), each row showing slug, title, lifecycle status, evidence count, and solution count.
3. **Problem detail.** I can open a Problem and see, in one view: the description; Evidence list with Observation content inlined; Solutions with status; latest Decision (rationale + context, chosen + rejected solution slugs); Eliminations (rationale + ruled-out solutions); Abandonment (rationale, if present); Outcomes (impact + learnings).
4. **Follow a Solution.** I can open a Solution and see which Problem it belongs to, its status, the Decision that chose or rejected it (if any), and its Outcome (if shipped).
5. **Follow an Observation.** I can open an Observation and see its content, source/source-type/tags, and every Problem it supports as Evidence (with the Evidence note).
6. **Unlinked intake queue.** I can see recent Observations not linked to any Problem as Evidence — the clustering queue.
7. **Ideas queue.** I can see unpromoted Ideas (no `originating_idea_id` reference from any Solution).
8. **Archive toggle.** Archived entities (`archived_at IS NOT NULL`) are hidden by default in queues 6 and 7. A toggle reveals them with their archive rationale visible inline.

## Shared technical contract

- **Data source.** Read directly from the libSQL file via `@crux/core` schema and `getDb()`. Do NOT shell out to the CLI or parse `crux context --json`.
- **Workstream-scoped.** All views except the overview live under a workstream slug.
- **Read-only.** No mutations. Both surfaces are inspection-only for v1.
- **Archive semantics.** Match `crux context`: archived hidden from `recent_observations_unlinked` and `unpromoted_ideas` by default; archived Observations linked as Evidence remain visible under their Problem with archive metadata inline.
- **Empty states.** Every list view must render a sensible empty state ("no open problems," "no unlinked observations," etc.) — not a blank panel.
- **Order.** Problems sorted by roadmap `status` (`now` → `next` → `later` → null/unscheduled → `done` → `abandoned`) then `createdAt` ascending. Evidence sorted by `createdAt` ascending. Solutions sorted by status (`chosen`, `shipped`, `evaluated`, `proposed`, `rejected`) then `createdAt`.

## Out of scope (v1)

- Filing or editing entities (mutation).
- Cross-workstream audit / dashboard.
- Search within a workstream.
- Graph visualization (just linked navigation, not a visual graph).
- Auth or multi-user.
- Real-time data updates. Mutation events (marking done, adding outcomes, etc.) do not push to open surfaces — a manual browser refresh is required after data changes. Navigation via the view-state machine (`crux view send`) does update surfaces live.

## Surface-specific notes

### Web UI (`apps/web/`)

- Stack: Next.js (App Router), Bun runtime, Tailwind CSS, shadcn/ui components.
- Local-only for v1. Run via `bun run dev` from `apps/web/`. Deployment is a separate later concern.
- Routes (suggested, not mandatory): `/` → workstream overview; `/w/<slug>` → workstream dashboard; `/w/<slug>/problems/<problem-slug>` → problem detail; `/w/<slug>/solutions/<solution-slug>` → solution detail; `/w/<slug>/observations/<obs-id>` → observation detail; `/w/<slug>/queues/intake`, `/w/<slug>/queues/ideas` → queues. Archive toggle as a query param (`?show-archived=1`) or persisted client state.
- Component shape: workstream layout shell with sidebar/breadcrumb; Problem detail uses cards or sections per entity type; status colors via shadcn badges.
- Direct libSQL reads happen server-side (Server Components or Route Handlers). Don't ship the db client to the browser.

### TUI (`packages/cli/src/commands/browse.ts`)

- Stack: ink (React reconciler for terminal). `ink-select-input` for list nav, `ink-text-input` if any filter input is added.
- Entry point: `crux browse [-w <slug>]`. With `-w`, opens the workstream dashboard. Without, opens the workstream picker.
- Layout: two-pane (list left, detail right) for dashboards and detail views; full-pane for picker. Keyboard nav: arrow keys to move, enter to drill in, escape/backspace to go back, `a` to toggle archived, `q` to quit.
- Color: status badges via ink's `Text color` props. Conventions: chosen=green, shipped=cyan, proposed=yellow, rejected=red, evaluated=blue, archived=gray.
- Don't try to build a panel-stack history — a single back-step (escape) is enough for v1.

## Acceptance per story

For each user story above, the surface must:

- Render the named entities in the named order.
- Apply archive-hiding by default; reveal on toggle.
- Show an empty state when the section has zero rows.
- Be reachable from at least one preceding view (no orphaned routes/screens).

## Verification plan

For each surface independently:

1. Seed `.crux.db` (`bun run seed`) and confirm the workstream overview lists `WS-crux`.
2. Open `WS-crux` and confirm all open Problems appear, P0 first.
3. Open `PRB-thinking-residue-gap`. Confirm: 11 Evidence entries with inlined Observations; 4 Solutions with statuses (`evaluated`, `chosen`, `rejected`, `rejected`); DEC-001 with chosen=`build-crux`, rejected=`status-quo`, full rationale + context; ELIM-001 with rationale; no Abandonment; no Outcome.
4. Open `PRB-schema-change-destroys-residue`. Confirm: status=done, DEC-003 visible, SOL-delete-reset-and-harden-env shown shipped, OUT-001 visible with observed/expected/learnings.
5. Follow a Solution from `SOL-archive-with-rationale` and confirm it shows `PRB-observation-correction-gap` as parent + DEC-002 as choosing decision.
6. Follow an Observation from `OBS-012` (issue #1 obs) and confirm it shows two Problems linked as Evidence (`observation-correction-gap`, `external-intake-gap`).
7. Open the unlinked intake queue. Confirm: empty (or correct contents).
8. Open the ideas queue. Confirm: 4 Ideas visible.
9. Toggle archived. Confirm any archived rows appear with rationale inline.
10. Empty states render where applicable (e.g., `PRB-skill-proposal-form-mismatch` has no Eliminations).

## Anti-goals (don't do this)

- Don't add "edit" or "create" affordances even if "they'd be easy to add later." Read-only is a hard line for v1.
- Don't build a graph/network visualization. Linked navigation (clicking through) is sufficient.
- Don't import the spec into Crux as a Problem description. The Problem stays at `human-readable-surface-gap`; the spec lives here in `docs/`.
- Don't depend on the CLI as a runtime dependency. Direct db access only.
