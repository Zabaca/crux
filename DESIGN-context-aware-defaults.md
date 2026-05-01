# Context-Aware Defaults — Design Exploration

## Problem (cli-ergonomics-gap)

CLI has scattered friction points:
- `--help` blocked by required-arg validation (can't use `--help` without `-w`)
- Arg parsing inconsistent (evidence link needs `--observation`, solution ship takes positional)
- Docs have typos
- Collectively slow adoption and exploration

## Solution: context-aware-defaults

Load view-state.json at command start. Infer `--workstream` and `--problem` from current view state context.

**Git-like behavior**: `crux decision add --chosen sol-name --rationale "..."` works without `-w` if in `workstream_dashboard` state.

**Trade**: Commands silently infer context — can surprise users who forget state.

---

## Codebase Review

### 1. View-State Architecture (`packages/core/src/view-state/`)

**Current shape** (view-state.json):
```typescript
type ViewMeta = {
  xstate?: PersistedViewSnapshot;  // XState internals
  value: unknown;                  // { viewing: "workstream_list" | "workstream_dashboard" | ... }
  context: {
    workstreamSlug: string | null;
    problemSlug: string | null;
  };
  revision: number;                // incremented on every action (mutation + view)
  lastAction: { kind: string; ts: number } | null;
  recentQueries: RecentQuery[];
};
```

**Loading**: `loadViewMeta()` reads from disk, defaults all fields, tolerates missing/corrupt file.

**Persistence**: 
- `saveState()` via XState (handles value, context)
- `saveViewMeta()` handles sidecar (revision, lastAction, recentQueries)
- Atomic writes via tmp + rename

**Revision use today**: 
- Bumped on every action (see dispatch.ts line 84)
- Used for audit/telemetry
- **No optimistic locking** — revisions don't gate mutations

### 2. Dispatch Flow (`packages/core/src/actions/dispatch.ts`)

```
dispatch(action) →
  1. loadViewMeta(path) — read current revision + view state
  2. Branch: ViewAction → sendViewEvent; MutationAction → runMutation
  3. nextRevision = revision + 1
  4. saveViewMeta(..., { revision: nextRevision })
  5. Return { revision, viewState?, result? }
```

Caller (CLI or UI) receives new revision but **doesn't use it to gate next mutation**.

### 3. CLI Command Pattern (`packages/cli/src/commands/`)

Each command:
```typescript
const addCmd = defineCommand({
  args: {
    workstream: { type: "string", required: true, alias: "w" },
    problem: { type: "string", required: true },
    chosen: { type: "string", required: true },
    // ...
  },
  async run({ args }) {
    // 1. Citty parses args, enforces required fields
    // 2. Validates via Zod schemas
    // 3. Executes mutation
  }
});
```

**No view-state loading today.** Each command independently requires `-w`, `-p` etc.

---

## Implementation Path

### Phase 1: Arg Inference (MVP)

1. **Load view-state at command start** (each defineCommand's run handler)
   ```typescript
   const meta = loadViewMeta();  // Already exported from @crux/core/view-state
   ```

2. **Make `-w` and `-p` optional, infer from context**
   ```typescript
   args: {
     workstream: { type: "string", required: false, alias: "w" },
     problem: { type: "string", required: false },
     // ...
   }
   
   async run({ args }) {
     const ws = args.workstream ?? meta.context.workstreamSlug;
     const pr = args.problem ?? meta.context.problemSlug;
     if (!ws) throw new Error("no workstream in args or view state");
     // ...
   }
   ```

3. **Single-solution inference**
   - When `--problem` is known and has 1 solution, infer `--solution`
   - Requires a query: `select solutions where problemId = ? and status != 'rejected'`

### Phase 2: Optimistic Locking (User's Proposed Trade)

**Goal**: Prevent stale writes when view state changes between read and mutation.

**Mechanism**:
1. **Include revision in mutation payload**
   - Pass `{ ..., expectedRevision: <current-revision> }` to action
   - Example: `dispatch({ kind: "ADD_DECISION", payload: { workstream, problem, chosen, expectedRevision: 42 } })`

2. **Gate mutation on revision match** (in dispatch.ts)
   ```typescript
   export async function dispatch(action, options): DispatchResult {
     const meta = loadViewMeta();
     
     // New: check expected revision
     if (action.expectedRevision !== undefined && action.expectedRevision !== meta.revision) {
       throw new StaleRevisionError(
         `revision mismatch: expected ${action.expectedRevision}, got ${meta.revision}. Re-read state.`,
         { expected: action.expectedRevision, actual: meta.revision }
       );
     }
     // ... rest of dispatch
   }
   ```

3. **Client responsibility**
   - CLI reads revision at command start
   - Passes it with the action
   - On `StaleRevisionError` (exit code?), exits with "state changed, re-run command" message
   - User re-reads view state, re-runs
   - UX: retry loop with backoff, or just exit + message

**Why this works**:
- **Prevents concurrent mutations on stale state**: If two terminals both read revision=5, only first wins. Second fails immediately.
- **Simple**: No distributed locking, no CAS operations. Just a version check.
- **Git-like**: Similar to "working on a branch that moved — rebase first" pattern.
- **Opt-in**: Commands that don't care about staleness can omit `expectedRevision`.

### Phase 3: Smart Defaults & Help

1. **--help bypass for required args**
   - Wrap citty's `defineCommand` to detect `--help` early, bypass required-arg validation
   - Or: make `-w` never required when `--help` is present

2. **Improve docs**
   - Fix typos in binary path
   - Document arg parsing consistency (positional vs `--flag`)

---

## Critical Files to Touch

| File | Change |
|------|--------|
| `packages/cli/src/commands/{decision,outcome,evidence,...}.ts` | Load `loadViewMeta()`, infer `-w`/`-p` |
| `packages/core/src/actions/dispatch.ts` | Add `expectedRevision` check |
| `packages/core/src/actions/schemas.ts` | Add optional `expectedRevision` to all MutationAction payloads |
| `packages/core/src/actions/mutations.ts` | Pass through (or drop) `expectedRevision` in runMutation |

## Sequencing

1. **Arg inference solo** — ship as independent feature, get feedback
2. **Then optimistic locking** — if users like the git-like behavior, add the safety net
3. **Then --help bypass** — easier in isolation once users are familiar with context defaults

## Open Questions

1. **Single-solution inference scope**: Should it only fire if there's *exactly* 1 non-rejected solution? Or does `--chosen` unambiguously pick it anyway?
2. **Revision error UX**: Exit code? Message? Suppress revision number (just say "state changed")?
3. **Help bypass**: Do we wrap citty, or just make `-w` truly optional when `--help` is present?
4. **Backwards compat**: Today's scripts passing `-w` always still work, right? (Yes — arg inference only fills gaps.)
