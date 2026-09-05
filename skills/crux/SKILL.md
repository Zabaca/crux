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
crux observation list -w crux --show-archived   # archived rows too
crux observation show OBS-17
crux observation revise OBS-17 --content "..." --reason "..."
crux observation revisions OBS-17               # what it used to say
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

**Revise when the row is wrong**, not when the world moved. An Observation is a raw
signal, and it is editable anyway because the freeze was a proxy for durability that
the kept history now supplies directly (ADR-0017): correct a sentence that was false
when you wrote it, and leave one that was true on the day and has since been fixed —
that is what archiving says. Correct rather than archive-and-refile, which orphans any
Evidence already pointing at the row. An archived Observation is still revisable.
`observation show` carries a marker; the history is the second read.

**Archive** is terminal, takes no `-w` (the id names the row), and is for misfiles,
duplicates, and evaporated relevance. Archived rows drop out of default queues but
stay visible under any Problem's Evidence with the rationale inlined.

Concretely: `crux observation list`, `crux observation list --unlinked` and
`crux search` all leave archived rows out, and `--show-archived` on any of them
puts them back with the rationale attached. `crux observation show OBS-17` still
answers — naming a row is asking for that row — and so does every Evidence link
under a Problem. So a search before filing does **not** see archived
Observations: that is deliberate, and re-filing something that was archived is
cheaper than quoting a retired row as though it were live.

## Problem

A synthesized "there is a thing worth solving." Titles are a noun phrase naming the
gap, one sentence.

### Search first — always

```sh
crux search "<a few distinctive words>"
```

Never file a Problem without searching. A near-twin splits one thing's Evidence across
two rows and neither reads as load-bearing afterwards. Search covers Problem titles and
descriptions and Observation content, across **every** Workstream by default
(`-w <slug>` narrows, `--limit` caps at 20 of each kind, `--show-archived` includes
archived Observations, which are otherwise left out). Matching is case-insensitive
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

**A Problem can be corrected, and the corpus keeps what it used to say** (ADR-0017).
Only the fields you pass change; `--reason` is optional and worth giving.

```sh
crux problem revise 42 --title "..." --reason "the Evidence demoted the cause"
crux problem revisions 42                 # what it used to say, newest first
```

Revise when the row is **wrong** — the Evidence overturned the claim it makes. That is
not the same as the world having moved on, which is what archiving says. Still write
the description to survive revision: state what is observed and name what is still
undecided, rather than baking in a conclusion the Evidence may overturn. `problem show`
carries a marker when a Problem has been revised; the history itself is the second read.

**Write it to survive that anyway.** A revision is a correction with a history, not a
cheap rewrite — it costs a `--reason` and it leaves what the row used to say sitting in
the record. Four moves, in order, as plain paragraphs:

1. **What is observed.** The situation, and the rows, measurements or commands behind
   it — concrete enough that somebody else could re-derive it.
2. **What it costs.** Why this is worth solving rather than merely true: who pays, when,
   and whether the cost grows. A Problem with no impact is an Observation.
3. **How it differs from its nearest neighbour.** Only when the search turned one up.
   Name it, and say what makes this one not that one.
4. **What is not asserted.** The undecided part — candidate causes you have not
   measured, mechanisms you are not yet claiming. This is what lets the row survive
   being revised by its own Evidence, and it is the move most often skipped.

Do not state the fix, or what you expect to be true once it is solved. What became of a
Problem is the Outcome's job, and `--observed-impact` is required there precisely
because it has to be observed rather than predicted.

Plain paragraphs, no headings: a description renders as escaped text with newlines
preserved, so a `##` shows up literally.

Every other prose-bearing row corrects the same way, with the same pair of verbs:

```sh
crux evidence revise EVD-003 --note "..."          # the why-note
crux outcome revise OUT-002 --observed-impact "..." --learnings "..."
crux abandonment revise ABN-42 --rationale "..."
crux workstream revise -w crux --title "..." --description "..."
```

`workstream revise` has no `--slug` and refuses one: a slug is how the Workstream
is addressed, not something it said — `crux workstream rename` is what changes it.
Revising an Outcome or an Abandonment corrects the prose and nothing else; the
Problem stays `done` or `abandoned`. `evidence revisions`, `outcome revisions`,
`abandonment revisions` and `workstream revisions -w <slug>` are the history reads,
and the marker rides `outcome show`, `abandonment show`, `workstream show` and
every row of `evidence list`.

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
crux attempt revise ATT-001 --ref ENG-413 --reason "the first ref resolved to nothing"
crux attempt revisions ATT-001
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
- **A wrong `ref` is corrected, never dropped-and-refiled.** `attempt revise` fixes the
  `ref`, the `--label` or the closing note (`--note`, only on an Attempt that has one)
  and never touches `status` — a correction is not a transition. Closing an Attempt
  `dropped` to fix a pointer puts a row representing no abandoned work into the
  graveyard reserved for judgments about why an approach ended.

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

## When something behaves oddly, say which pair you were running

A `crux` command is an HTTP call, so a session is a client *and* a deployment, and the
two are updated independently — the client on the user's plugin-update schedule, the
deployment when somebody releases. When a read comes back surprising or a page looks
wrong, the pair is the first thing an Observation about it needs:

```sh
${CLAUDE_PLUGIN_ROOT}/bin/crux version
```

It reports `client`, `deployment` and the `url` it asked. Put those in the Observation's
content. It never fails: an unreachable deployment, or one too old to report a version,
is `deployment: null` at exit 0, and nothing is minted to ask.

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
