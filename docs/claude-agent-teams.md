# Claude Agent Teams — Internals

Findings from inspecting Claude Code's `TeamCreate` / `SendMessage` machinery on a local install (Claude Code 2.1.123, binary-only — source not available).

## On-disk layout

`TeamCreate` writes:

```
~/.claude/teams/{team-name}/
  config.json           # team metadata
  inboxes/
    {recipient}.json    # per-recipient message queue (created on first delivery)

~/.claude/tasks/{team-name}/
  .lock                 # task list directory (empty until first TaskCreate)
```

### `config.json` schema

```json
{
  "name": "test1",
  "description": "Test team",
  "createdAt": 1777475066934,
  "leadAgentId": "team-lead@test1",
  "leadSessionId": "fa2ed0cd-db01-4246-af83-e683df0210f1",
  "members": [
    {
      "agentId": "team-lead@test1",
      "name": "team-lead",
      "agentType": "team-lead",
      "model": "claude-sonnet-4-6",
      "joinedAt": 1777475066934,
      "tmuxPaneId": "",
      "cwd": "/Users/uptown/Projects/zabaca/crux",
      "subscriptions": []
    }
  ]
}
```

- `leadAgentId` — `"{role}@{team}"` form.
- `leadSessionId` — Claude session UUID that created the team.
- `members[].name` — used for `SendMessage({to: "..."})` routing.
- `members[].agentId` — internal identifier; do not use for messaging.
- `members[].cwd` — captured at join time.
- `members[].subscriptions` — purpose unconfirmed (likely event/topic filters).

### Inbox file schema

Two observed shapes (fields vary by sender path):

```json
[
  {
    "from": "iso-test",
    "text": "teting",
    "timestamp": "2026-04-18T01:39:01.153Z",
    "color": "green",
    "read": true
  },
  {
    "from": "team-lead",
    "text": "echo test — self message",
    "summary": "self test",
    "timestamp": "2026-04-29T16:15:26.112Z",
    "read": true
  }
]
```

- `summary` present on `SendMessage`-originated entries; `color` present on cross-agent deliveries.
- Each recipient has its own file (`team-lead.json`, `researcher.json`, ...). Messages append; `read` flips after delivery.

### Self-messaging

`SendMessage({to: "team-lead"})` from `team-lead` works end-to-end:

- Message writes to own inbox file (`read: true` immediately).
- Does NOT deliver within the sending turn.
- Surfaces on the next turn as a `<teammate-message>` block from self.
- Useful for queueing a fresh-turn note-to-self that bypasses current-turn context.

## Active team binding

**Active team is in-process state, not on disk.**

- Multiple teams can share the same `leadSessionId` (one Claude session, several `TeamCreate` calls).
- `leadSessionId` records *which session created the team*, not *which team a session is currently bound to*.
- Inbox routing uses the **active team binding** held in the running Claude binary's memory — last team the session interacted with via `TeamCreate` / explicit team context.
- Implication: if session A creates teams `x` and `y`, only the currently-active team's inbox gets processed. Messages to the inactive team's inbox sit unprocessed until the session re-binds (mechanism for re-binding from a stopped session is unclear — likely requires a fresh `TeamCreate` or session restart with team context).

Observed example: teams `crux-mvp-2` and `test1` both had `leadSessionId = fa2ed0cd-...`. Only `test1`'s inbox was processed (test1 created last in the active session). `crux-mvp-2/inboxes/team-lead.json` accumulated unread messages.

## Session state

`~/.claude/sessions/{pid}.json`:

```json
{
  "pid": 23163,
  "sessionId": "fa2ed0cd-db01-4246-af83-e683df0210f1",
  "cwd": "/Users/uptown/Projects/zabaca/crux",
  "startedAt": 1777474732140,
  "procStart": "Wed Apr 29 14:58:50 2026",
  "version": "2.1.123",
  "peerProtocol": 1,
  "kind": "interactive",
  "entrypoint": "cli",
  "status": "busy",
  "updatedAt": 1777477812871
}
```

No team field. Confirms team binding is runtime-only.

### Session identity vs process identity

`sessionId` is **conversation identity, not process identity**. Observed:

- `/compact` (multiple times): same `sessionId`, source `compact`.
- Exit + resume: same `sessionId`, source `resume`. New pid, but `sessionId` carried forward from transcript.
- `~/.claude/sessions/{pid}.json` is keyed by current pid; the `sessionId` field inside is stable across restarts of the same conversation.
- Implication: only `/clear` or a brand-new session mints a new UUID. Hooks keyed on `sessionId` survive compaction and resume.

## SessionStart hooks (related machinery)

Hook input via **stdin as JSON**, not shell vars:

```json
{
  "session_id": "...",
  "transcript_path": "...",
  "cwd": "...",
  "hook_event_name": "SessionStart",
  "source": "startup|resume|clear|compact",
  "model": "claude-sonnet-4-6"
}
```

- Parse with `jq` (e.g. `jq -r '"Session ID: " + .session_id'`).
- Matcher field is a **string** (tool name pattern or empty), not an object. Source-based filtering not supported via matcher.
- Hook stdout is **not visible in the UI** — surfaces as a `system-reminder` to Claude only. Blocking hooks (`PreToolUse`, `Stop` with exit 2) are different — their output renders to the user as block reasons.
- `$CLAUDE_ENV_FILE` available for persisting env vars across subsequent Bash calls in the session.

## Practical takeaways

- Don't rely on `leadSessionId` for routing logic. Read the active team from runtime, not from config.json.
- Stale teams accumulate inbox messages silently. Clean up with `TeamDelete` when done.
- `SendMessage` `to` field always uses `members[].name`, never `agentId`.
- Inbox files are append-only logs; safe to inspect for debugging stuck delivery.
