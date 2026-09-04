---
name: crux
description: How Crux works and how to drive it — Workstreams, Observations, Problems, Evidence, Attempts, Outcomes — through the `crux` CLI. Use whenever a discovery or design conversation produces something worth keeping, when reloading what a past session concluded, or when work about a known Problem starts or ends somewhere else.
---

# Crux

Crux is a **problem registry**. It keeps the problem and the evidence behind it, so a
later session reloads what was concluded instead of re-deriving it. It does **not**
keep the work — that lives in whatever tracker you already use.

There are no modes. Capture as things surface, synthesize when there is something to
synthesize, record what became of a Problem when you know. The entities below are the
whole model, and the invariants are enforced server-side: you cannot close an Attempt
twice, cannot record a second Outcome, cannot archive an archived Observation.

## Running the CLI

`crux` is the plugin-bundled binary. Use the explicit path — it is not on `$PATH`, and
each Bash call is a fresh shell:

```sh
${CLAUDE_PLUGIN_ROOT}/bin/crux problem list -w crux
```

- **JSON is the default output.** No `--json` needed; the flag is a deprecated no-op.
- **Every command that acts on a Workstream takes `-w <slug>`, always.** There is no
  current Workstream and no fallback. Agents run in parallel against one Principal, so
  a shared default is how two of them file into each other's corpus. Omitting `-w`
  refuses with `VALIDATION_ERROR` (exit 24) rather than guessing.
- Ids are explicit too. `crux problem list -w <slug>` shows them.
- The wrapper runs `bun install` on first use. The only prerequisite is Bun
  (`command -v bun`); if missing, `curl -fsSL https://bun.sh/install | bash`, then
  restart the shell.
- **Nothing to sign up for.** The first command that touches the corpus mints a
  Principal and writes the token to `~/.claude/.crux/config.toml`. Do not ask for a URL
  or a token. Only if the user runs their own deployment: `crux init --url … --token …`.

## Loading context

There is no single command that loads everything, deliberately — a digest that inlined
every Observation behind every Problem grew with the corpus and stopped being cheaper
than re-deriving it. Walk the cheap reads and stop when you know enough. Each is flat
in the size of the corpus:

```sh
crux workstream list                       # which corpora exist, by slug
crux problem list -w <slug>                # every Problem: id, stage, title
crux problem show 42                       # one Problem, with Attempts and Outcome
```

`--status now` narrows that to the field, but reload unfiltered: a Problem is filed
unscheduled and stays there until someone stages it, so filtering by stage hides the
newest synthesis — the thing a fresh session most needs and least expects to be missing.

Deeper, only for a Problem that has earned it:

```sh
crux evidence list 42                      # what supports it, and why
crux attempt list 42                       # work elsewhere, with closing notes
crux observation list -w <slug> --unlinked # intake nobody has synthesized
crux abandonment list -w <slug>            # dead ends, with reasons
```

Read `attempt list` before proposing a direction — a closed Attempt's note says why an
approach ended, and re-proposing one that was dropped for a reason still standing is
the specific waste Crux exists to prevent.

---

## Workstream

A coherent area of focus — per client, per product. The container everything else
lives in. Slugs are kebab-case area names: `crux`, `farm-app`, `client-acme`.

```sh
crux workstream list
crux workstream add --slug crux --title "Crux" --description "Building Crux itself."
crux workstream show WS-crux
crux workstream rename WS-crux --title "..."
```

If you do not know which slug to pass, run `crux workstream list` and ask. Never guess,
and never fall back to "the last one" — there is no such thing.

## Observation

Atomic intake. Cheap to create, never deleted. The thing you file mid-conversation
when something worth remembering surfaces.

```sh
crux observation add -w crux --content "..." \
  --source "where this came from" \
  --source-type internal \
  --tag "perf,d1"
crux observation list -w crux
crux observation list -w crux --unlinked        # the review queue
crux observation show OBS-17
crux observation archive OBS-17 --rationale "..."
```

`--source-type` is one of `internal`, `competitive`, `external`, `analysis`,
`customer_report`, `metric_signal`.

**Use the comma-separated form for `--tag`.** The repeatable form silently keeps only
the last value.

**Duplication among Observations is by design.** They are cheap, and two people
noticing the same thing twice is signal. Do not deduplicate them.

**File when:** the user articulates a claim, a constraint, a measurement, or a
source-grounded observation worth keeping.

**Do not file when:** it is pure implementation or debugging (code goes in files); the
user is thinking out loud and nothing is settled; it is a to-do or reminder (Crux is
not a task tracker); or you are tempted to file something the user did not say. Cheap
intake is a feature, but so is judgment — a blurry thought filed early is drag on every
later reload.

**Archive** is terminal, takes no `-w` (the id names the row), and is for misfiles,
duplicates, and evaporated relevance. Archived rows drop out of default queues but
stay visible under any Problem's Evidence with the rationale inlined.

## Problem

A synthesized "there is a thing worth solving." Titles are a noun phrase naming the
gap, one sentence; the description is the paragraph.

### Search first — always

```sh
crux search "<a few distinctive words>"
```

Never file a Problem without searching. A near-twin splits one thing's Evidence across
two rows and neither reads as load-bearing afterwards. Search covers Problem titles and
descriptions and Observation content, across **every** Workstream by default
(`-w <slug>` narrows, `--limit` caps at 20 of each kind). Matching is case-insensitive
substring and not word-aware, so search a distinctive stem (`auth`, `onboard`) rather
than a sentence, and try two or three wordings before concluding nothing exists.

- **Same thing** → do not file. Attach as Evidence instead.
- **Adjacent but genuinely different** → file, and say in the description how it differs.
- **Nothing matches** → file it.

```sh
crux problem add -w crux --title "..." --description "..."
crux problem list -w crux --status now
crux problem show 42
```

`--status` is one of `now`, `next`, `later`, `unscheduled`, `done`, `abandoned`.

**A Problem cannot be edited after filing.** Write the description to survive
revision: state what is observed and name what is still undecided, rather than baking
in a conclusion the Evidence may overturn.

### Scheduling

```sh
crux problem schedule 42 --stage now      # now | next | later
crux problem unschedule 42
```

Problems start unscheduled. Schedule only when the user has expressed genuine intent —
`now` is actively in flight, `next` is queued, `later` is acknowledged but not soon.
Leave it unscheduled rather than guess. A stage is a schedule, not a direction.

### Evidence

Links an Observation to a Problem with a why-note. Both ids are positional.

```sh
crux evidence link OBS-17 42 --note "why this supports it"
crux evidence list 42
```

When an Observation supports an existing Problem, link it — do not rewrite the Problem
statement to absorb the new weight. Evidence preserves the origin trail; Problem
statements stay stable.

### Abandonment

```sh
crux problem abandon 42 --rationale "..."
crux abandonment list -w crux
```

Terminal, and a real event rather than deletion. The graveyard keeps its dignity:
abandoned ≠ deleted, and the rationale travels forward so a later session does not
re-derive the dead end.

## Attempt

A pointer to work about a Problem happening in another tracker. **Crux does not own the
build.**

```sh
crux attempt add --problem 42 --ref ENG-412 --label "Batch the writes"
crux attempt list 42
crux attempt close ATT-001 --status shipped --note "why it ended that way"
crux attempt drift -w crux
```

**File it when the work starts, not when it finishes.** `attempt drift` reports
Problems staged as active with no *open* Attempt — the signal that a stage was set and
nothing is happening. Filing late destroys the one thing the entity produces.

- **There is no description field**, and that refusal is load-bearing. What the work
  *is* lives in the system `--ref` points at; a second copy in Crux is the one that
  rots.
- **`--note` on close is the whole point.** It is the judgment the tracker never keeps:
  a closed ticket says "won't do", it never says the approach could not handle the load.
  Required, on both `shipped` and `dropped`.
- **Status is a coarse local marker and goes stale.** Nothing polls the tracker; the
  `ref` is authoritative. `shipped` means the approach ended by landing, not that
  anything reached production.
- **A shipped Attempt does not complete the Problem.** Something shipping is a fact
  about the world; the Problem being gone is a judgment somebody makes.

## Outcome — completing the Problem

Recording the Outcome **is** completing the Problem. One act, one command, one Outcome
per Problem, terminal:

```sh
crux problem complete 42 \
  --observed-impact "what actually changed, measured" \
  --learnings "what is worth keeping" \
  --follow-up-problems 43,44
```

There is no other way to reach `done`, and no way to record an Outcome without
completing the Problem. A Problem leaves the board only through a door that demands a
reason: `done` carries an Outcome, `abandoned` carries a rationale, neither is a silent
flip.

`--observed-impact` is required, and that requirement is the discipline: you cannot
complete a Problem without having observed something. If the fix shipped but you have
not checked whether the Problem is gone, **do not record an Outcome yet**.

The Outcome is *informed by* the Attempts but is not the sum of them. A Problem can
have three shipped Attempts and still be open — that is the honest state, and it is
what the model exists to express. Equally, a Problem can resolve for a reason none of
the Attempts caused, and *that* is the most valuable thing in the record.

`--follow-up-problems` takes ids that already exist, and can only be set here. Read
back with `crux outcome show <id>` / `crux outcome list`.

---

## The human's view — readable, never drivable

```sh
crux view get     # what they are looking at: state + context
crux view path    # the endpoint serving it
```

One view is shared by every client holding this Principal's token, so moving it would
move the page under whoever is reading it. There is no `view send`, no `view next`, no
`view reset`, and no `workstream select`.

**Never take a default from the view.** `context.workstreamId` is where *they* are, not
where your write belongs. That comes from `-w <slug>`, chosen from `workstream list`,
every time.

## Attribution

Everything you file belongs to the Principal the token resolves to, which the server
determines from the request — never from local config. `crux user init` writes a local
`[user]` block and makes no request; it does not set authorship. **You are a tool, not
an actor:** a human owns Principals, and every attribution resolves to one. Keep the
"Claude noticed this" versus "the user said this" distinction in the content or tags,
never in the identity.

## When a write refuses with `CAPACITY_EXCEEDED` (exit 27)

The Principal has spent its free allowance of Observations. **Writes pause; every read
keeps working**, so reloading context is unaffected. The error's `details` carry `cap`,
`observations` and `claimUrl`.

Say so in the conversation where it happened — this is the moment the wall matters —
and offer the one command that lifts it:

```sh
crux claim <their-email>
```

That mails a link; opening it is what attaches the address. Ask for the address rather
than guessing. An address nobody here has *names* this Principal; an address that
already has an identity here *links* this Principal to it. Neither rewrites anything
already filed, and claiming is also what makes a corpus recoverable — the deployment
stores only the token's hash, so losing `config.toml` strands everything filed under it.

Do not retry, do not mint a fresh Principal to route around it, and do not silently
drop what the user asked to file. Tell them it was not filed, and hold the content.
