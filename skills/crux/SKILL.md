---
name: crux
description: Capture observations mid-conversation through the `crux` CLI — cheap, low-friction intake. Use during discovery/design conversations whenever something worth remembering surfaces; do not use for implementation-only work.
---

# Crux — intake mode

Crux is a product-thinking residue tool. This skill is the **default intake mode**: capture Observations as they surface, cheaply, without trying to synthesize them into Problems on the spot.

## How to invoke the CLI

`crux` refers to the plugin-bundled binary at `${CLAUDE_PLUGIN_ROOT}/bin/crux`. Always use that explicit path — not on `$PATH`, and each Bash call spawns a fresh shell so aliases don't persist.

```sh
${CLAUDE_PLUGIN_ROOT}/bin/crux context
```

**JSON is the default output format** — no `--json` flag needed. The `--json` flag is a deprecated no-op alias kept for back-compat only.

**`-w` flag has been removed.** All commands infer workstream from view-state. If no workstream is in view-state, commands fail with a clear error — run `crux view send SELECT_WORKSTREAM --payload '{"id":"WS-<slug>"}'` first.

The wrapper lazily runs `bun install` on first use, so no separate deps check needed.

## Collab mode (CRUX_COLLAB=1)

When the environment variable `CRUX_COLLAB=1` is set, the CLI enforces view-state–aware action permissions. Mutations not allowed in the current view state will hard-reject with exit code 25 (`[ACTION_NOT_ALLOWED]`). The web UI auto-refreshes on any dispatched mutation via SSE. The web UI dispatches via `POST /api/action`; same `dispatch()`, same allow-list (always enforced for UI calls).

**Per-view allowed mutations:**

| View | Allowed mutations |
|---|---|
| `workstream_list` | ADD_WORKSTREAM, RENAME_WORKSTREAM |
| `workstream_dashboard` | ADD_PROBLEM, ADD_OBSERVATION |
| `problem_detail` | ADD_SOLUTION, ADD_EVIDENCE, ADD_DECISION, ADD_ELIMINATION, ADD_OUTCOME, SCHEDULE_PROBLEM, ABANDON_PROBLEM, RENAME_PROBLEM, SHIP_SOLUTION |
| `intake_queue` | ARCHIVE_OBSERVATION, ADD_OBSERVATION |

**Global (always allowed):** ADD_OBSERVATION, BACK.

Use `crux view get` to inspect current state and allowed actions:

```sh
${CLAUDE_PLUGIN_ROOT}/bin/crux view get
# → { value, context, revision, lastAction, allowedActions[], globalActions[] }
```

When CRUX_COLLAB is absent (default), all commands fall through to direct mode without view-state checks.

## When to invoke (intake)

- User articulates a claim, observation, source-grounded constraint worth remembering → `crux observation add`.
- An existing Observation was misfiled or became irrelevant → `crux observation archive <obs-id> --rationale "..."`. Terminal.

That's the full intake surface.

## Search before you synthesize a Problem

**Never file a Problem without searching first.** Duplication among Observations
is by design — they are cheap, and two people noticing the same thing twice is
signal. Duplication among Problems is the failure this rule exists to prevent: a
near-twin splits the Evidence for one thing across two rows, and neither reads as
load-bearing afterwards.

So before `crux problem add`, run:

```sh
${CLAUDE_PLUGIN_ROOT}/bin/crux search "<a few distinctive words>"
```

It answers with `{ query, problems[], observations[] }` — each match carrying its
`workstreamSlug`, and each Problem its full title and description, which is what
you judge sameness against. It searches **every** Workstream by default, because a
near-twin filed in the wrong one is exactly what you want to find; add
`--workstream <slug>` to narrow, `--limit <n>` to cap (default 20 of each kind).

Matching is a case-insensitive substring, not word-aware: search a distinctive
stem (`auth`, `onboard`) rather than a whole sentence, and run it two or three
times with different words before concluding nothing exists.

Then:

- **A match is the same thing** → do not file a second Problem. Attach the
  Observation to the existing one as Evidence, with a why-note:
  `crux evidence link <obs-id> <problem-id> --note "..."`.
- **A match is adjacent but genuinely different** → file the new Problem, and say
  in its description how it differs from the one you found.
- **Nothing matches** → file it.

## When NOT to invoke

- Pure implementation or debugging — code goes in files.
- User venting / exploring out loud, nothing settled.
- You're tempted to file something the user didn't actually say.
- To-dos and reminders. Crux is not a task tracker.

Low-friction intake is a feature, but so is judgment. A blurry thought filed prematurely creates drag on every later reload.

## First-run init

Before the first `crux` command in a session, run these checks in order. Steady state → all no-op.

1. **Bun runtime**: `command -v bun`. If missing, surface install:
   - macOS/Linux: `curl -fsSL https://bun.sh/install | bash`
   - Homebrew: `brew install oven-sh/bun/bun`
   - Windows: `powershell -c "irm bun.sh/install.ps1|iex"`
   - User must restart shell after install.
2. **Plugin deps**: `test -d ${CLAUDE_PLUGIN_ROOT}/node_modules`. Wrapper auto-installs on first invocation; pre-warm with `${CLAUDE_PLUGIN_ROOT}/bin/crux --help`.
3. **Deployment**: `grep -q '^\[api\]' ~/.claude/.crux/config.toml`. If absent, ask for the deployment URL and the bearer token minted for this user, then `${CLAUDE_PLUGIN_ROOT}/bin/crux init --url "..." --token "..."`. There is no local database — every command is an HTTP call.
4. **User config**: `test -f ~/.config/crux/config.toml`. If missing, ask name/email then `crux user init --name "..." --email "..."`.
5. **Agent bus**: `TeamCreate` with `team_name: "crux"`. If team already exists, skip. Then write runtime pointer:
   ```sh
   CRUX_HOME="${CRUX_HOME:-$HOME/.claude/.crux}"
   mkdir -p "$CRUX_HOME"
   SESSION_ID=$(cat "$CRUX_HOME/session-id" 2>/dev/null)
   cat > "$CRUX_HOME/runtime.json" <<EOF
   {
     "teamName": "crux",
     "inboxPath": "$HOME/.claude/teams/crux/inboxes/team-lead.json",
     "sessionId": "$SESSION_ID",
     "updatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
   }
   EOF
   ```
6. **Web UI**: `lsof -i :3210 | grep LISTEN`. If down, start:
   ```sh
   ${CLAUDE_PLUGIN_ROOT}/bin/crux web start
   ```
   Polls until ready and opens browser automatically.

## Load context before contributing

When user names a workstream, run before adding state:

```sh
crux context
```

This emits **now-only** by default (workstream + seed_version + `now` bucket). For intake mode this is correct — you get active work without the full corpus. Use `--stage` or `--all` to opt into more:

- `--stage=now,next` — specific buckets, comma-separated. Valid values: `now`, `next`, `later`, `unscheduled`, `done`, `abandoned`.
- `--all` — all six stage buckets plus `recent_observations_unlinked`.

For intake mode, anchor on:

- `now[]` — active Problems; avoid filing Observations that duplicate in-flight work.
- If you need to check unlinked observations, run with `--all` instead.

If no workstream is in context and you can't infer one from cwd, ask before inventing.

## Attempts (work happening elsewhere)

Crux does not own the build. When work about a Problem starts in another tracker
— an issue, a PR, a board card — record it as an Attempt: a pointer, not a copy.

```sh
crux attempt add --problem 42 --ref https://tracker/ENG-412 --label "Batch the writes"
crux attempt list 42
crux attempt close ATT-001 --status shipped --note "Landed, but backpressure is still unsolved"
crux attempt drift            # active Problems with no open Attempt
```

- **Never describe the work here.** There is no description field and the server
  refuses a payload carrying one — what the work *is* lives in the system `--ref`
  points at, and a second copy would rot.
- `--note` on close is the one thing the tracker never keeps: *why* the approach
  ended the way it did. A closed ticket says "won't do"; it never says the
  approach could not handle the load.
- Closing an Attempt as `shipped` does **not** complete the Problem. Something
  shipping is a fact about the world; the Problem being gone is a judgment
  somebody makes.
- The status is a coarse local marker and goes stale — nothing polls the tracker.
  The `ref` is authoritative.

## Archive (intake hygiene)

Observations are never deleted — origin trail is permanent — but misfiles happen. Use archive when:

- Typo, test row, wrong workstream
- Obvious duplicate of existing row
- Relevance evaporated mid-conversation

Archive is terminal — no un-archive. Archived rows hide from default queues but remain visible under any Problem's Evidence with rationale inlined.

## Slugs and titles

- Workstream slug: kebab-case area name — `crux`, `farm-app`, `client-acme`.
- Titles are one sentence. Descriptions are the paragraph.

## Attribution

`reporter_id` comes from `~/.config/crux/config.toml`. If a command fails with "no user configured," run `crux user init`.

**You (Claude) are not a User.** Everything you file is attributed to the human. Preserve the "Claude noticed this" vs "user said this" distinction in tags/phrasing, not in the reporter field.

## View control bus

The view-state machine tracks what the user is looking at across web UI and TUI. Use to navigate surfaces and read current focus without screenshots.

```sh
crux view get --json        # current state + context
crux view next --json       # legal events from current state
crux view send <EVENT> --json
crux view send <EVENT> --payload '{"id":"x"}' --json
crux view reset --json
crux view path
```

`crux view send` fails non-zero if event is refused. Check `crux view next` first when uncertain.

**Critical:** Always use `crux view send`; never edit `view-state.json` directly. Direct edits bypass guards and corrupt state.

**Data mutations do not push to surfaces.** Open web UI won't auto-refresh on db changes — user must reload. Navigation does update live. Two separate channels.

## Browse (TUI fallback)

When web UI isn't running, `crux browse -w <slug>` opens an interactive terminal UI. Same view-state machine.
