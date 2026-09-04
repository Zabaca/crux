---
name: agent-sessions
description: Find which Claude Code sessions are live, which agent profile each one is running, and where its transcript file is — then read that transcript. Use when asked to observe, watch, follow or check on another session or agent, when you need a session's JSONL path, or when two sessions in the same directory have to be told apart.
---

# agent-sessions

Resolves an **agent profile** to the **session** running it and the **transcript** on
disk. One command, no guessing.

```sh
bun run .claude/skills/agent-sessions/sessions.ts                        # profiles in this cwd
bun run .claude/skills/agent-sessions/sessions.ts --agent crux-product   # one profile
bun run .claude/skills/agent-sessions/sessions.ts --all                  # every directory
bun run .claude/skills/agent-sessions/sessions.ts --read crux-85 --tail 20
bun run .claude/skills/agent-sessions/sessions.ts --follow crux-observer   # watch, at stops
```

**Only sessions running an agent profile are listed.** Plain sessions are the majority —
7 shared this repo's directory against 3 with a profile on the day this was written — and
none of them is what the question means. There is no flag to include them.

Stdout is JSON: `{cwd, count, sessions[]}`. Each session is **the whole registry record**
plus `transcript` (an absolute path, or `null` when none is on disk) — `agent`, `name`,
`status`, `kind`, `cwd`, `sessionId`, `startedAt`, `updatedAt`, and alongside them `pid`,
`version`, `procStart`, `entrypoint`, `bridgeSessionId` and `messagingSocketPath`.

Those last ones are reach, not noise. **`messagingSocketPath`** (`/tmp/cc-socks/<pid>.sock`)
is how a session is talked to rather than only read; `pid`, `procStart` and `version` are
what separate a live row from a stale one when `status` lies, which it does.

`--read` takes a `name`, an `agent` or a `sessionId` and returns `{session, turns[]}` with
`{role, ts, text}` per turn, oldest last. It exits 1 when nothing matches or the
transcript is missing.

## Watching: `--follow`

Takes the same key and blocks, writing **one JSON object per completed turn** — JSONL, so
it streams:

```json
{"session":"crux-85","agent":"crux-product",
 "stop":{"ts":"…","durationMs":59990,"messageCount":18},
 "turns":[{"role":"assistant","ts":"…","text":"…"}]}
```

**The boundary is the session's own stop marker**, a `system` line with subtype
`turn_duration` written last — not a line count and not file growth. Polling for growth
wakes you mid-turn, and most of what looks wrong mid-turn is corrected inside that same
turn by the session itself, so an observer woken on every message is reviewing a draft. A
stop is also the moment the session hands something to its human, which is when reading it
is worth most.

It starts at the current end of the file, so it follows what happens next. `--from-start`
replays every completed turn first — what an observer joining a session already in
progress wants. `--interval <seconds>` sets the poll, default 5. Only lines past the last
poll are parsed, so a long transcript costs its growth rather than its size.

## Why not ListAgents

`ListAgents` enumerates live sessions and `SendMessage` talks to one, but the listing
carries only a name, a kind, a state and an age. **It does not report which agent profile
a session is running, and hands back no transcript.** Sessions are named after their
directory, so several agents working one repo all answer to the same prefix — five
`crux-*` sessions were live the day this was written. The listing cannot tell them apart;
this can.

Use both when it matters: `ListAgents` is the liveness cross-check, and the two disagree
about `status` often enough that neither should be trusted alone.

## What it reads

`~/.claude/sessions/*.json` — one file per live session. The `agent` key is present only
on sessions started under an agent profile, which is what makes the lookup exact.

The transcript path is **derived and then checked**: the project directory is the session's
`cwd` with `/` replaced by `-`, and if that file is absent the script scans
`~/.claude/projects/` for `<sessionId>.jsonl`. The slug rule is an observation about paths
seen on this machine rather than a documented contract, so the fallback is what keeps a
wrong derivation from returning a silent `null`.

## Reading a transcript is not reading a mind

The turns tell you what was **said**, never what was **meant**, and a session's own
summary of its work is a claim rather than a result. When intent is ambiguous, watch what
the session does next instead of inferring. When it reports an outcome, check the
artifact.

`status` goes stale — a session that finished a second ago may still read `busy`. Prefer
`updatedAt`, or the transcript's own last line, over the field.
