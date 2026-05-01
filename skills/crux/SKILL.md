---
name: crux
description: Capture observations and ideas mid-conversation through the `crux` CLI — cheap, low-friction intake. Synthesis (problems, solutions, decisions) is deferred to `/crux:review`. Use during discovery/design conversations whenever something worth remembering surfaces; do not use for implementation-only work.
---

# Crux — intake mode

Crux is a product-thinking residue tool. This skill is the **default intake mode**: capture Observations and Ideas as they surface, cheaply, without trying to synthesize them into Problems on the spot.

Synthesis — promoting Observations into Evidence on Problems, creating new Problems, ruling out or committing to Solutions — is the job of a separate review pass. Run `/crux:review` when the user is ready to do that work.

Mixing intake and synthesis raises capture friction and produces premature problem statements. Keep them apart.

## How to invoke the CLI

`crux` refers to the plugin-bundled binary at `${CLAUDE_PLUGIN_ROOT}/bin/crux`. Always use that explicit path — not on `$PATH`, and each Bash call spawns a fresh shell so aliases don't persist.

```sh
${CLAUDE_PLUGIN_ROOT}/bin/crux context -w <slug>
```

**JSON is the default output format** — no `--json` flag needed. The `--json` flag is a deprecated no-op alias kept for back-compat only.

The wrapper lazily runs `bun install` on first use, so no separate deps check needed.

## Collab mode (CRUX_COLLAB=1)

When the environment variable `CRUX_COLLAB=1` is set, the CLI enforces view-state–aware action permissions. Mutations not allowed in the current view state will hard-reject with exit code 25 (`[ACTION_NOT_ALLOWED]`). The web UI auto-refreshes on any dispatched mutation via SSE.

**Per-view allowed mutations:**

| View | Allowed mutations |
|---|---|
| `workstream_list` | ADD_WORKSTREAM, RENAME_WORKSTREAM |
| `workstream_dashboard` | ADD_PROBLEM, ADD_OBSERVATION, ADD_IDEA |
| `problem_detail` | ADD_SOLUTION, ADD_EVIDENCE, ADD_DECISION, ADD_ELIMINATION, ADD_OUTCOME, SCHEDULE_PROBLEM, ABANDON_PROBLEM, RENAME_PROBLEM, SHIP_SOLUTION |
| `intake_queue` | ARCHIVE_OBSERVATION, ADD_OBSERVATION |
| `ideas_queue` | ARCHIVE_IDEA, ADD_IDEA |

**Global (always allowed):** ADD_OBSERVATION, ADD_IDEA, BACK.

Use `crux view get` to inspect current state and allowed actions:

```sh
${CLAUDE_PLUGIN_ROOT}/bin/crux view get
# → { value, context, revision, lastAction, allowedActions[], globalActions[] }
```

When CRUX_COLLAB is absent (default), all commands fall through to direct mode without view-state checks.

## When to invoke (intake)

- User articulates a claim, observation, source-grounded constraint worth remembering → `crux observation add`.
- User floats a solution-space hunch without a matching Problem yet → `crux idea add`.
- An existing Observation or Idea was misfiled or became irrelevant → `crux observation archive <obs-id> --rationale "..."` / `crux idea archive <slug> -w <ws> --rationale "..."`. Terminal.

That's the full intake surface. Anything else — Problems, Evidence, Solutions, Eliminations, Decisions, Outcomes, scheduling — belongs in `/crux:review`.

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
3. **Database**: `test -f ~/.local/share/crux/crux.db`. If missing, `${CLAUDE_PLUGIN_ROOT}/bin/crux init`.
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
   cd <repo-root> && bun run --filter @crux/web dev &> /tmp/crux-web-dev.log &
   ```
   Wait ~3s, verify `curl -s -o /dev/null -w "%{http_code}" http://localhost:3210/`. Open in browser for user.

## Load context before contributing

When user names a workstream, run before adding state:

```sh
crux context -w <slug>
```

This emits **now-only** by default (workstream + seed_version + `now` bucket). For intake mode this is correct — you get active work without the full corpus. Use `--tier` or `--all` to opt into more:

- `--tier=now,next` — specific buckets, comma-separated. Valid values: `now`, `next`, `later`, `unscheduled`, `done`, `abandoned`.
- `--all` — all six tier buckets plus `recent_observations_unlinked`, `unpromoted_ideas`, and `themes`. Use for full review (`/crux:review`).

For intake mode, anchor on:

- `now[]` — active Problems; avoid filing Observations that duplicate in-flight work.
- If you need to check unlinked observations or ideas, run with `--all` instead.

If no workstream is in context and you can't infer one from cwd, ask before inventing.

## Propose-then-file, don't silently file

When you decide something should be captured, propose it in **prose** first — entity type, content summary, key fields (workstream, source-type, tags). What the user reviews is substance, not shell syntax. Example:

> I'd file an **Observation** (external, tagged `dogfood,intake`) — _"GitHub issue #1: observations have no correction path..."_

Don't lead with the CLI invocation. Invoke once user approves.

Skip the preview only when user explicitly authorized batch capture ("just file the observations from this conversation").

## Observation vs Idea

- **Observation** = problem-space, source-grounded (user report, metric, reading, internal experience).
- **Idea** = solution-space hunch without a matching Problem yet.

If it comes from a source, Observation. If it's a vague "what if we just…", Idea.

**Do not link Observations to Problems here.** Even when an Observation obviously supports an existing Problem, file it standalone in intake mode. The link gets made deliberately during `/crux:review` so the user reviews the synthesis. Premature linking buries weak evidence under strong-looking trails.

## Archive (intake hygiene)

Observations and Ideas are never deleted — origin trail is permanent — but misfiles happen. Use archive when:

- Typo, test row, wrong workstream
- Obvious duplicate of existing row
- Relevance evaporated mid-conversation

Archive is terminal — no un-archive. Archived rows hide from default queues but remain visible under any Problem's Evidence with rationale inlined.

## Slugs and titles

- Workstream slug: kebab-case area name — `crux`, `farm-app`, `client-acme`.
- Idea slug: descriptive hunch — `auto-link-strong-evidence`, `notion-mirror`. Not outcomes.
- Titles are one sentence. Descriptions are the paragraph.

## Attribution

`reporter_id` comes from `~/.config/crux/config.toml`. If a command fails with "no user configured," run `crux user init`.

**You (Claude) are not a User.** Everything you file is attributed to the human. Preserve the "Claude noticed this" vs "user said this" distinction in tags/phrasing, not in the reporter field.

## Handoff to review

When the user says they want to review observations, promote ideas, shape Problems, file Solutions, or commit a Decision, switch to `/crux:review`. That skill owns the full synthesis surface (problem add/schedule/abandon, evidence link, solution add, elimination, decision, outcome).

Signal phrases that should hand off: "let's review what we've captured," "promote that into a problem," "file a decision," "rule that out," "what should we work on next."

## View control bus

The view-state machine tracks what the user is looking at across web UI and TUI. Use to navigate surfaces and read current focus without screenshots.

```sh
crux view get --json        # current state + context
crux view next --json       # legal events from current state
crux view send <EVENT> --json
crux view send <EVENT> '{"slug":"x"}' --json
crux view reset --json
crux view path
```

`crux view send` fails non-zero if event is refused. Check `crux view next` first when uncertain.

**Critical:** Always use `crux view send`; never edit `view-state.json` directly. Direct edits bypass guards and corrupt state.

**Data mutations do not push to surfaces.** Open web UI won't auto-refresh on db changes — user must reload. Navigation does update live. Two separate channels.

## Browse (TUI fallback)

When web UI isn't running, `crux browse -w <slug>` opens an interactive terminal UI. Same view-state machine.
