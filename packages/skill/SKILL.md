---
name: crux
description: Discovery residue discipline — capture observations, shape problems, record decisions via the crux CLI rather than letting them evaporate in chat.
---

# Crux skill (v1, thin on purpose)

This skill is a promise to the next session more than a how-to. Patterns live here; prose grows as we see which ones survive dogfooding.

## When to invoke Crux

- You formed a claim about a user, pattern, or constraint worth remembering → `crux observation add`.
- You argued for or against a direction → `crux problem ...`, `crux solution ...`, `crux decision add`.
- You reloaded a session and need state → `crux context -w <slug>`.

If unsure, lean toward recording. Retrieval cost is low; re-derivation cost is high.

## Inline-propose pattern

When acting autonomously, propose entities inline in the conversation with a command block the user can run or edit. Don't silently write. Example:

```sh
crux observation add -w crux --content "..." --source "claude-session:$(date +%F)"
```

This keeps attribution honest (the human who runs the command is the reporter) and keeps the user in the loop.

## Reload command

At session start, if the workstream is known, run:

```sh
crux context -w <slug> --json
```

Parse the JSON, anchor on `open_problems[].problem.lifecycleStatus` and `legal_next_transitions`.

## Entity intake discipline

- Observation: atomic, claim-shaped, first-person-source-grounded. Tag with `source=claude-session:YYYY-MM-DD`.
- Problem: stated as a problem, not a feature. Title is a noun phrase; statement is a sentence that could be falsified.
- Solution: tied to exactly one Problem. Multiple Solutions per Problem is the norm, not an edge case.
- Decision: carries rationale. Rejected Solutions are explicit, not implied.

## Non-goals for v1

No theme management, no outcome recording, no idea tracking via the CLI yet. If you want those, capture them as Observations with tags and we'll backfill once Pass 2 lands.
