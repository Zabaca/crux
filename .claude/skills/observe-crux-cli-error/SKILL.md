---
name: observe-crux-cli-error
description: Scan Claude Code session logs for crux CLI errors since last run, archive a structured report, and file one observation into WS-crux.
---

# observe-crux-cli-error

Implements DEC-021 (S63): periodic manual JSONL analysis, zero instrumentation.

## Steps

### 1. Run the scanner

```sh
bun run .claude/skills/observe-crux-cli-error/observe-crux-cli-errors.ts
```

Parse stdout as JSON. Fields: `ran_at`, `since`, `sessions_scanned`, `total_errors`, `by_code`, `instances`, `report_file`.

### 2. Check for errors

If `total_errors === 0`:

```
No new crux CLI errors since last run.
```

Stop. Do not file an observation.

### 3. Compose observation content

```
CLI error scan <ran_at date>: <total_errors> errors across <sessions_scanned> sessions since <since date>

<CODE> (<count>x): <first example message>
<CODE> (<count>x): <first example message>
...

Report archived at <report_file>
```

Use short ISO date (YYYY-MM-DD) for the dates in header.

### 4. Ensure WS-crux selected

```sh
crux workstream select crux
```

### 5. File observation

```sh
crux observation add \
  --content "<composed content>" \
  --source "claude-code session logs" \
  --source-type metric_signal \
  --tag cli-errors \
  --json
```

### 6. Print observation ID

Print the `id` field from the JSON output (e.g. `OBS-042`).
