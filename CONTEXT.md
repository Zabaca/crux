# Crux — Glossary

Canonical vocabulary for this repo. Terms land here when they get resolved in a design session; see `docs/adr/` for the decisions behind them. Domain terms only — system internals (dispatch, and view-state — which is a human at a screen rather than shared state, [ADR-0014](docs/adr/0014-view-state-is-the-humans.md)) stay in code and specs.

## Entities

- **Workstream** — a coherent area of focus (per client, per product). Everything below belongs to exactly one Workstream.
- **Observation** — atomic intake: a raw signal worth keeping. Cheap to create; never deleted — corrected or retired by *archiving* (with a rationale), so history stays intact.
- **Problem** — a synthesized "there's a thing worth solving," distilled from Observations. The durable artifact: Crux keeps Problems, not the work done about them (ADR-0012).
- **Evidence** — the link from an Observation to a Problem, carrying a why-note. An Observation *is not* Evidence until it's linked with a reason.
- **Attempt** — a pointer to work happening somewhere else about a Problem: a `ref` into a tracker, a label, and one of `open`, `shipped`, `dropped`. Deliberately holds no description of the work — that lives in the linked system — and its status is a coarse local marker, not a mirror (ADR-0012).
- **Closing note** — the judgment recorded when an Attempt stops being open: why the approach ended the way it did. The one thing the linked system never keeps, and the reason an Attempt is more than a URL.
- **Abandonment** — giving up on a Problem itself, with the reason. The graveyard keeps its dignity: abandoned ≠ deleted.
- **Outcome** — what became of a Problem; closes the loop. One per Problem, terminal, and recording it *is* what marks the Problem done. May spawn follow-up Problems.

- **Principal** — the identity a client acts as: a token, not a person. Minted automatically on first use, it owns everything filed through it and is the unit both tenancy and capacity are scoped to (ADR-0013). Not an agent either: every client configured with the same token is the same Principal, which is why nothing that must differ per agent — the Workstream being written to, the screen being looked at — may be keyed by it (ADR-0014).
- **Claim** — attaching a human to a Principal by email. The deployment stores only the token's hash, so a Principal with no address attached is exactly as durable as the one `config.toml` holding it; claiming is therefore what makes a corpus recoverable, not only what lifts the cap. It names an unclaimed Principal, or links one to a human who already exists; it never rewrites the rows the Principal authored, so a person may own many Principals.
- **Capacity** — the cap on how many Observations an unclaimed Principal may file. Reaching it refuses *writes* only; reads never stop working. A nudge toward claiming, explicitly not a security control.
- **Workspace** — a crux deployment and the Members in it. It names the deployment in the header and is *not* a schema entity; since ADR-0013 it is also no longer the boundary of what anyone can see — that is the Principal.
- **Member** — a claimed human invited to a Workspace.
- **Invite** — a one-time, expiring permission to become a Member. Redeeming one creates the `users` row that a browser session *and* a CLI token both resolve to (ADR-0007); the invite is then spent, not deleted, so who invited whom survives. Since ADR-0013 it is no longer the only way in — first use mints a Principal without one.
- **Removal** — ending a Membership without ending the person. The `users` row is stamped, never deleted, because every Observation, Problem and Outcome cites it as its author; what ends is the way in — no sign-in link is mailed, no browser session resolves, no CLI token authenticates. Reversible by the same door they came in — an invite to that address reinstates the same row, history and tokens intact.

## Lifecycle vocabulary

- **Stage** — a Problem's place on the roadmap: **now**, **next**, or **later**. A Problem starts **unscheduled** (not on the roadmap); scheduling places it in a stage; it ends **done** or **abandoned** (terminal).
- **Unscheduled** — filed but not yet placed on the roadmap (status null). Not a bug, not a backlog: simply awaiting scheduling.
- **Terminal door** — the rule that a Problem may only leave the board through a transition that demands a reason: `abandoned` carries a rationale, `done` carries an Outcome. There is no silent completion, and a shipped Attempt never closes a Problem on its own (ADR-0012).
- **Drift** — a Problem staged as active with no open Attempt against it. What the corpus is meant to make visible: a stage is a schedule, not a direction.

## Doc conventions

- **Graduate (a doc section)** — move a section out of the shared README into its own file behind a short pointer, triggered by the section's *size*, never by which audience it serves (ADR-0001).
- **Reachable (a doc)** — part of the project's documentation only if the doc tree walker can reach it from README, via internal links or Claude Code `@import`s (ADR-0002).
- **Rot (structural)** — a broken internal link, or an *orphan*: a doc file that exists on disk but is unreachable from README. What the walker catches. *Content* rot — a reachable doc stating stale facts — remains a human/agent judgment.
