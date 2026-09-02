# Crux is a problem registry; it does not own the build

Crux keeps Observations, Evidence and Problems. It does not keep the work.
`Solution`, `Elimination` and `Decision` are deleted, along with the
`elimination_solutions` and `decision_rejected_solutions` join tables, and are
replaced by one thin entity: an **Attempt**, which is a pointer to work
happening somewhere else.

The deliberation half was Crux trying to own a space it had already decided not
to own. Other tools — issue trackers, kanban boards, the repo itself — are where
work gets described, scheduled and shipped. What they all lack, and what nothing
else keeps, is a durable record of the *problem* and the evidence behind it.
That is the whole product; the rest was scope.

It had also stopped working, in ways that read as symptoms of a layer nobody
exercised. `solutions.effort` was in the DDL and rendered by the TUI, but no
action could set it — unreachable since the CLI became an HTTP client (ADR-0003).
`outcomes.expected_impact` was supplied in the same `ADD_OUTCOME` call as
`observed_impact`, which `recordOutcome` refuses until the Solution is already
shipped: Crux asked what you expected *after* it knew what happened, making
`learnings` a comparison with one side written in hindsight. And the plugin
skill — the primary surface — taught `observation add` and `observation archive`
and said "that's the full intake surface." Four of nine entities were
unreachable from the tool meant to drive them.

## An Attempt is a pointer, not a copy

An Attempt is `problem_id`, `ref`, `label`, `status`, an optional
`closing_note`, and the usual authorship. Status is three terminal-ish values —
`open`, `shipped`, `dropped` — not a lifecycle.

It has **no description**, and that refusal is the load-bearing part. The moment
Crux stores a description of the work there are two sources of truth about it,
and the copy in Crux is the one that rots — which is the failure Crux exists to
prevent. The line is temporal: forward-looking content about what will be built
belongs to the ticket; the backward-looking judgment about *why an attempt
ended* belongs here, because a closed ticket says `Won't Do` and never says the
approach couldn't handle backpressure. That judgment is what `closing_note`
holds, and it is the one thing worth keeping from `Elimination.rationale`.

Attempts are written by a human or an agent through `dispatch`, with the user's
own token. Crux does not poll the linked system and nothing pushes into it. The
local status therefore goes stale, and that is accepted: the `ref` is
authoritative, and Crux's copy is a coarse marker whose only job is to answer
`Problem in now AND zero open Attempts` — the drift query. That query tolerates
staleness. A synced field would not merely be redundant, it would look
trustworthy while being wrong.

## Outcome moves to the Problem, and becomes the door

`Outcome` reattaches from Solution to Problem: one per Problem, terminal, and
`recordOutcome` now writes the row *and* sets `status = 'done'` in a single
batch — exactly the shape `abandonProblem` already had. `markProblemDone` and
its `chosenSolutionIsShipped` predicate are deleted.

A Problem now leaves the board only through a door that demands a reason:
`abandoned` carries a rationale, `done` carries an Outcome, neither is a silent
flip. A shipped Attempt does **not** complete a Problem — something shipping is
a fact about the world, and the Problem being gone is a judgment somebody makes.
Conflating those is what made `expected_impact` meaningless.

## Considered alternatives

**Fix the existing layer** — make `description` required, move `expected_impact`
onto Solution, make `effort` reachable. This treats the symptom. The layer
wasn't broken because it was unfinished; it was unfinished because it was asking
Crux to hold something another tool already holds better.

**Delete it outright with no replacement.** Rejected: without any record of work
in flight, a Problem in `now` that is being actively built looks identical to
one that has been sitting untouched for a month — and making that difference
visible is the drift problem Crux was built for. Stage is a schedule, not a
direction.

**An append-only log on the Problem** instead of a row. Rejected: the
cross-workstream audit question has to be answerable by query. Against prose it
is not, and the doc hunt Crux replaced would be back.

## Consequences

- **Progressive narrowing is gone.** Ruling options out one at a time without
  committing required enumerated options, and enumerating them was the part
  nobody did. If it returns, it returns as evidence of a need rather than as an
  aspiration built in advance.
- **The handoff artifact is a resolved Problem plus its refs**, not a chosen
  option. A builder gets the *why* and a pointer, which is the half no tracker
  carries.
- **Ten read kinds and four transition modules go with the entities.** The
  invariant surface shrinks to Problem staging, the two terminal doors, and
  Observation archiving.
- **`README.md` and `skills/crux/SKILL.md` describe the old model** and are not
  corrected by this ADR. `docs:check` catches structural rot only, so neither
  will fail the build.
