# Crux — Glossary

Canonical vocabulary for this repo. Terms land here when they get resolved in a design session; see `docs/adr/` for the decisions behind them. Domain terms only — system internals (view-state, dispatch) stay in code and specs.

## Entities

- **Workstream** — a coherent area of focus (per client, per product). Everything below belongs to exactly one Workstream.
- **Observation** — atomic intake: a raw signal worth keeping. Cheap to create; never deleted — corrected or retired by *archiving* (with a rationale), so history stays intact.
- **Problem** — a synthesized "there's a thing worth solving," distilled from Observations.
- **Evidence** — the link from an Observation to a Problem, carrying a why-note. An Observation *is not* Evidence until it's linked with a reason.
- **Solution** — one option for solving a specific Problem.
- **Elimination** — a "no" without a winner: rules Solutions out to narrow the field progressively, committing to nothing.
- **Decision** — a "yes": commits to one chosen Solution and records the losers. A later Decision may **supersede** an earlier one.
- **Abandonment** — giving up on a Problem itself, with the reason. The graveyard keeps its dignity: abandoned ≠ deleted.
- **Outcome** — what shipping actually produced; closes the loop. Only exists once a Solution has shipped, and may spawn follow-up Problems.

- **Workspace** — a crux deployment and the members invited to it. Deliberately *not* a schema entity and not a container above Workstream: the deployment is the tenant boundary, and every member sees every Workstream in it (ADR-0003). A group that shouldn't share a corpus gets its own deployment.
- **Member** — a user invited to a Workspace. Membership is coarse by design: it grants the whole deployment, never a subset of Workstreams.
- **Invite** — a one-time, expiring permission to become a Member. It is the only way an account is created: nobody signs themselves up. Redeeming one creates the `users` row that a browser session *and* a CLI token both resolve to (ADR-0007); the invite is then spent, not deleted, so who invited whom survives.

## Lifecycle vocabulary

- **Stage** — a Problem's place on the roadmap: **now**, **next**, or **later**. A Problem starts **unscheduled** (not on the roadmap); scheduling places it in a stage; it ends **done** or **abandoned** (terminal).
- **Unscheduled** — filed but not yet placed on the roadmap (status null). Not a bug, not a backlog: simply awaiting scheduling.
- **Rejected** (Solution) — ruled out, terminally. One status, two provenances: an Elimination (ruled out with no winner yet) or a Decision (lost to the chosen Solution). The *why* lives in that record, never in the status.
- **Solution statuses** — `proposed → evaluated → chosen → shipped`, with `rejected` as the terminal "no" from either path.

## Doc conventions

- **Graduate (a doc section)** — move a section out of the shared README into its own file behind a short pointer, triggered by the section's *size*, never by which audience it serves (ADR-0001).
- **Reachable (a doc)** — part of the project's documentation only if the doc tree walker can reach it from README, via internal links or Claude Code `@import`s (ADR-0002).
- **Rot (structural)** — a broken internal link, or an *orphan*: a doc file that exists on disk but is unreachable from README. What the walker catches. *Content* rot — a reachable doc stating stale facts — remains a human/agent judgment.
