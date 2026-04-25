# Agent-driven view control — POC spec

A control bus between the agent (CLI), the web UI, and the TUI, built on a file-based XState machine. POC scope.

## Why

The web UI and TUI shipped read-only. Two gaps remain:

- **Live data freshness**: when the agent writes to the db, surfaces don't auto-update. User must reload or re-navigate.
- **No agent-driven view control**: the agent has no channel to drive what the user is looking at. "As we discuss this Problem, navigate the user's view to its detail page" is impossible.

Filed in-db as `PRB-agent-driven-view-control` (P2) with three candidate Solutions. This spec implements `SOL-file-based-xstate-control-bus` as a POC.

## Why XState (not flat JSON)

Three properties XState gives that flat JSON can't, and that the agent specifically depends on:

1. **Discoverability** — `state.nextEvents` returns the legal events from the current state. The agent can read the file, ask the machine "what can I do from here?", and know its options without external docs.
2. **Invariant enforcement at write time** — transition guards reject illegal events before they advance state. Drift is structurally prevented, not policed by convention.
3. **Machine-as-contract** — the machine definition is a checked contract between CLI, web, and TUI. Adding a feature means adding states/events explicitly; surfaces break at compile time when the contract changes.

This extends Crux's existing principle ("transitions are code, not documentation") from entity workflow to view control.

## Why file-as-bus (not daemon + SSE)

- No long-running process required. Surfaces stay standalone.
- Mirrors Crux's existing principle: source of truth is a file. libSQL is the data truth; `view-state.json` becomes the view truth.
- Inspectable by hand: `cat view-state.json` shows the current view state.
- Replayable — the file (or a write-log derived from it) is the trace of every state change.

The web's transport between filesystem and browser still happens via the Next.js server (it does `fs.watch` and streams SSE to the client), but that's the web UI's own server, not a separate control-bus daemon.

## Authoritative model

The machine is the single source of view truth. Surfaces are pure renderers of state. Every UI navigation is also a state event sent into the machine — clicking a link calls `sendViewEvent('OPEN_PROBLEM', ...)`, which mutates the file, which both surfaces observe and re-render from.

## POC scope

Minimal machine to prove the bus works end-to-end. Cover three states, three events. Machine grows organically as features land.

### States

```
viewing.workstream_list
viewing.workstream_dashboard   (context: workstreamSlug)
viewing.problem_detail         (context: workstreamSlug, problemSlug)
```

### Events

- `SELECT_WORKSTREAM { slug }` — from `workstream_list` → `workstream_dashboard`. Guarded by "workstream exists in db."
- `OPEN_PROBLEM { slug }` — from `workstream_dashboard` → `problem_detail`. Guarded by "problem exists in current workstream."
- `BACK` — from any nested state to the parent.

### Persistence

Serialized state at `~/.local/share/crux/view-state.json` (XDG) by default. Honors `CRUX_VIEW_STATE_PATH` env var override. In dev mode (per `bin/crux` cwd-scope guard), writes to `<repo>/.view-state.json`.

Format: whatever XState's `state.toJSON()` produces. Rehydratable via `machine.resolveState(JSON.parse(content))`.

### CLI verbs

- `crux view get [--json]` — print current state value + context.
- `crux view send <EVENT> [--payload '{...}']` — send event. Fails with non-zero exit + structured error if guard rejects or event is illegal in current state. Prints the new state.
- `crux view next [--json]` — print legal events from current state. (For the agent's discoverability.)
- `crux view reset` — reset to initial state.

## Architecture

### Machine

`packages/core/src/view-state/machine.ts` — XState v5 machine. Pure. No IO.

### Persistence layer

`packages/core/src/view-state/persistence.ts` — `loadState(path)`, `saveState(path, state)`, default-path resolver.

### File watcher

`packages/core/src/view-state/file-watcher.ts` — `watchViewStateFile(path, onChange)` returning `{ stop }`. Uses chokidar. Debounces 200ms.

### CLI

`packages/cli/src/commands/view.ts` — citty subcommand registering `get | send | next | reset`.

### TUI integration

`packages/cli/src/browse/App.tsx` — add a `useViewStateFile()` hook that subscribes via the file watcher and surfaces `currentState` to the React tree. The existing in-process navigation also routes through `sendViewEvent` rather than direct setState. Watcher receives the same change and reconciles — idempotent because the in-process write already produced the new state.

### Web integration

- `apps/web/app/api/view-state/route.ts` — SSE endpoint that watches the file server-side and streams `data: <json>\n\n` per change.
- `apps/web/components/view-state-listener.tsx` — client component mounted in root layout. Opens `EventSource('/api/view-state')`. On message, parses state, calls `router.push(stateToPath(state))`. Uses `router.replace` if the URL is already correct (idempotent).
- `apps/web/lib/state-to-path.ts` — pure function from machine state → URL path. Used both by the SSE listener (to navigate on incoming state) and by link click handlers (to navigate locally + send the event back to the machine).

### Symmetry note

For both surfaces, user interactions flow into the machine the same way agent interactions do: the click handler calls `sendViewEvent`, the file mutates, the surface re-renders from the new state. There is no separate "user nav" code path — everything is a machine event.

## Tests

Four files, all isolated, all sub-second. No browsers, no subprocess management, no Playwright. The wiring between layers (watcher → setState → re-render) is two-line code in each surface — trusted by inspection.

### `packages/core/src/view-state/machine.test.ts`

- Initial state is `viewing.workstream_list`.
- `SELECT_WORKSTREAM { slug: 'crux' }` from initial → `viewing.workstream_dashboard` with `workstreamSlug = 'crux'`. (Guard mocked to true.)
- `SELECT_WORKSTREAM { slug: 'nonexistent' }` is refused; state unchanged. (Guard mocked to false.)
- `OPEN_PROBLEM { slug: 'foo' }` from dashboard → `problem_detail` with both slugs in context.
- `BACK` from `problem_detail` → `workstream_dashboard` with workstream context preserved.
- `BACK` from `workstream_dashboard` → `workstream_list` with context cleared.
- `state.toJSON()` round-trips through `JSON.parse → machine.resolveState`.
- `machine.transition(state, ILLEGAL_EVENT)` returns the same state (no-op, no throw).

### `packages/core/src/view-state/file-watcher.test.ts`

- Write a tmp file. Start watcher with a callback. Mutate the file. Assert callback fires within 300ms.
- Rapid-mutate 5x within 50ms. Assert callback fires exactly once after debounce window.
- Mutate twice with a 500ms gap. Assert callback fires twice.
- Stop the watcher. Mutate. Assert callback does not fire.

### `packages/cli/src/browse/__tests__/render.test.tsx`

Use `ink-testing-library`. For each state value (workstream_list, dashboard, problem_detail), render the App component with that state as a prop, assert the rendered text contains the expected entity names. Use seeded `.crux.db`.

### `apps/web/__tests__/render.test.tsx`

Use `@testing-library/react` + `happy-dom`. For each state value, render the matching page component with the expected props (mocked router), assert the rendered HTML contains the expected entity names. Use seeded `.crux.db`.

## Verification

Beyond the four unit-test files (run via `bun test`), one manual end-to-end check at the end:

1. Start the web UI on port 5001 (or any free port).
2. Start the TUI in another terminal: `crux browse`.
3. From a third terminal: `crux view send SELECT_WORKSTREAM --payload '{"slug":"crux"}'`.
4. Observe both surfaces navigate to the WS-crux dashboard.
5. `crux view send OPEN_PROBLEM --payload '{"slug":"thinking-residue-gap"}'`. Observe both navigate to the problem detail.
6. `crux view send BACK`. Observe both navigate back.
7. Click a link in the web UI. Observe the TUI follow.
8. Press a key in the TUI. Observe the web follow.

The manual check verifies the transport (file watcher + SSE bridge + router.refresh) actually wires the layers together as expected. Sub-30-second test, run once at the end.

## Out of scope (POC)

- Hierarchical states beyond two levels.
- Modals / overlays.
- Undo history (XState supports it; not needed for POC).
- Solution-detail, observation-detail, queues. Add after the bus proves itself.
- Cross-workstream navigation in a single session.
- Conflict resolution if two agents write the file simultaneously. Last-writer-wins is fine for POC.
- Authoritative-vs-advisory toggle. POC is fully authoritative.

## Anti-goals

- Don't introduce a daemon. Both surfaces remain standalone.
- Don't share machine state in memory across processes. The file is the bus.
- Don't add agent-specific events (e.g., `AGENT_NAVIGATE_X`) — the agent and the user use the same event set. The agent has no privileges the user lacks.
