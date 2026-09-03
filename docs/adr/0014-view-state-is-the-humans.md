# View-state belongs to whoever is looking at it

Crux was designed as one agent paired with one human, on one Workstream,
looking at the same screen. That model is retired. An agent names the
Workstream it means on every command that acts — `-w <slug>`, no fallback — and
it may *read* the human's view but never move it. View-state stops being shared
state and becomes what it always described: a fact about a person at a screen.

## Why the pairing broke

View-state is a Durable Object keyed by Principal, and a Principal is one token
in one `config.toml` (ADR-0013). "The current Workstream" was therefore not one
per agent; it was one per machine:

```
agent A: crux workstream select alpha   -> view.workstreamId = WS-alpha
agent B: crux workstream select beta    -> view.workstreamId = WS-beta
agent A: crux observation add "…"       -> filed into WS-beta, ok: true
```

Nothing refused, nothing warned, and the write landed in a corpus that deletes
nothing. Ambient state keyed by an identity that several actors share is not a
convenience with an edge case; it is a silent-misfile bug whose likelihood rises
with the number of agents — which is the direction this product is going.
Agents are the primary users now, and they run in parallel.

The same reasoning applies twice, because the pairing coupled two things:

- **Writes.** A command that resolved its Workstream from view-state resolved
  it from whatever agent last touched the machine. Resolution now comes from the
  argument alone, and its absence is a refusal (`VALIDATION_ERROR`) rather than
  a guess.
- **The screen.** A command that *moved* view-state moved the page under
  whoever was reading it, and two agents fought over it. `crux view` keeps `get`
  and `path`; `next` and `reset` are gone, and so are the routes behind them, so
  the capability is removed rather than merely unexposed. `crux workstream
  select` goes with them — once nothing resolved a default from view-state,
  steering the human's screen was the only thing it still did. Discovery
  replaces selection: `workstream list` to choose, `-w` to act.

The view still moves. It moves through a view action on `/v1/dispatch`, which
is what the TUI sends as the human walks their own screen with their own
keyboard; the browser navigates by link and does not send one at all. What
changed is who may send it, not that it can be sent.

## What was given up

A real thing, and it is worth naming rather than pretending the old design was
merely wrong. "As we discuss this Problem, put it on your screen" worked, and
it was the best argument for the pairing: a conversation and a screen advancing
together, with no copy-pasted URLs. That is gone, and there is no smaller
version of it kept behind a flag — an agent-only navigation event would be the
same collision with a nicer name, and the retired spec's own anti-goal — "the
agent and the user use the same event set. The agent has no privileges the user
lacks." — is the argument against reintroducing it as a privilege.

What replaces it is the human following the agent by hand: the agent reports an
id, and the person opens it. Worse for one agent, correct for several.

## Live refresh is part of this decision, not next to it

Two changes look like unrelated freshness work and are not. Once the human's
screen is no longer steered, it has to keep up on its own — and once several
agents write at once, "keeping up" has to be selective or it becomes
interruption:

- **Change events name the Workstream they came from.** The push stream used to
  say only that a revision had moved, so every open page refetched on any action
  anywhere in the Principal's corpus — including work in a Workstream the page
  is not showing. `lastAction` now carries `workstreamId` (`null` when an action
  touched none), and a subscriber may filter on it.
- **The four data pages moved to Astro.** The Workstream list, Problem,
  Observation list and Observation pages are Astro routes because a live
  subscription needs an island; the views themselves are the same functions in
  `apps/cloud/src/web/`, so it was a routing change, not a rewrite
  ([ADR-0009](0009-astro-wraps-the-worker-entry.md)). The account pages stayed
  hand-written, because nothing an agent writes appears on them.

Read together: an agent files into the Workstream it named, and the human's
open page updates itself if that is the Workstream they are looking at. Neither
half moves the other's cursor.

## Consequences

- **`crux context` is gone**, deleted in the same goal. Its own defect was
  cost — it inlined every Observation behind every Problem, so the one command
  whose purpose was to be cheaper than re-deriving context was more expensive
  than re-deriving it — but it was also the last read that wanted a Workstream
  handed to it, and its replacement is the flat reads: `workstream list` →
  `problem list -w <slug>` → `problem show <id>`, each flat in the size of the
  corpus and each naming its Workstream. Getting warm is several calls now
  instead of one.
- **`context.workstreamId` from `crux view get` is at most where the human is,
  and never a default for a write.** At most, because only the TUI moves the
  view: for a human who only ever opens the browser it is stale or empty, which
  makes it worse as a default rather than better. Reading it as one is the trap
  that would reinstate the collision in agent reasoning rather than in code, so
  both plugin skills say so in words.
  A CLI test walks every source file and asserts two things: nothing reads
  `/v1/view` except `commands/view.ts` and the TUI under `browse/`, and nothing
  outside `browse/` — the human at their own keyboard — so much as mentions a
  view action kind.
- **The view machine stays.** `packages/core/src/view-state/` is still the
  authority on what a view is and which actions are legal from it, and the TUI
  is the one thing left that writes to it. Removing the agent's access removed
  callers, not the library.
- **[`docs/agent-driven-view-control-spec.md`](../agent-driven-view-control-spec.md)
  is superseded by this ADR.** It specifies the pairing in its anti-goals and a
  file-based XState bus that the Durable Object replaced (ADR-0004); it is kept
  as the record of a design that was built and retired, not as a plan.
- **A Principal is still not a person and now not an agent either.** It is the
  tenancy and capacity boundary (ADR-0013), shared by every client configured
  with the same token. Anything that must differ per agent cannot be keyed by it.
