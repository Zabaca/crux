# Changelog

What each release of cloud crux changed, for the people and agents using it.

A line earns its place here by naming something a user can **observe** — a
command that behaves differently, a page that exists, a refusal that now
explains itself. Work that changes nothing outside this repository gets one
sentence under **Under the hood**, at the bottom. This is not a commit log; for
that, read `git log`.

Every version here except `0.1.0` was cut by `/release`
([ADR-0015](docs/adr/0015-a-release-is-a-command-not-a-merge.md)), deployed, and
verified against `/health` before its tag was pushed. A tag on `origin` is
therefore a release that reached production and was checked there.

## 0.4.0 — 2026-09-04

A row that turns out to be wrong can be corrected, and the corpus keeps what it
used to say — while a row that has stopped being live stops answering the
queries that hunt for duplicates.

### The corpus can be corrected

- **Every prose-bearing row is revisable**, through one pair of verbs:
  `crux problem revise`, `observation revise`, `attempt revise`,
  `evidence revise`, `outcome revise`, `abandonment revise` and
  `workstream revise`. Only the fields you name change, naming none is a
  refusal rather than an empty write, and `--reason` is optional — the model
  demands one at terminal doors and leaves it optional at reversible ones.
- **What a row used to say is kept.** `crux problem revisions <id>`, and the
  same read on every other revisable entity, answers with the prior versions
  newest first, plus the optional reason each was changed. The row itself stays
  the single source of current truth; no ordinary read touches the history.
- **Every read that shows a revisable row says it was revised**, and how many
  times — `problem show`, `observation show`, `workstream show`, `outcome
  show`, `abandonment show`, and every row `attempt list` and `evidence list`
  answer with. The Problem and Observation pages in the browser carry the same
  marker. A row nobody has corrected shows nothing at all, and there is no diff
  viewer: what changed is the `revisions` read.
- **An Attempt's `ref` is corrected rather than dropped and refiled.** Getting a
  pointer wrong used to cost a terminal transition and left a `dropped` Attempt
  representing no abandoned work. `attempt revise` never touches `status` — a
  correction is not a transition — and a closing note may only be corrected on
  an Attempt that has one.
- **An Observation is editable**, despite being a raw signal, because the freeze
  was always a proxy for durability that the kept history now supplies
  directly. An archived Observation is still revisable: it stays reachable by id
  and under any Problem's Evidence, so a falsehood in it still informs a live
  conclusion.
- **`workstream revise` refuses `--slug`.** A slug is how a Workstream is
  addressed — by every `-w`, every URL and every reference an agent has stored —
  not something the row said. `crux workstream rename` keeps it.

### Archiving finally means something on read

- **Archived Observations leave `crux observation list`, `--unlinked` and
  `crux search`**, and `--show-archived` on any of them puts them back with the
  rationale attached. A listing that handed one back as though it were live is
  how a retired row silently informed a live conclusion.
- **Naming a row still answers.** `crux observation show OBS-17` returns an
  archived row, and so does every Evidence link under a Problem — that link is a
  deliberate assertion that this Observation supports this Problem, so hiding it
  would gut the Problem's argument rather than protect it.
- The cost, taken knowingly: the duplicate hunt before filing no longer sees
  archived rows, and re-filing a cheap Observation is the better of the two
  failures.

### Faster

- **A recorded read no longer waits on its own bookkeeping.** `PROBLEM_SHOW`
  appends to a `recentQueries` list in the view-state Durable Object — two
  sequential hops the answer does not depend on, measured at about 205ms in
  front of every such read. It now happens behind the response, and stays
  best-effort: a Durable Object that cannot be reached still cannot fail a read.

### Breaking

- **The `crux-review` skill is gone.** The one crux skill is now organised by
  the entity model and carries what the review skill taught, so a second skill
  restating the same model was the copy that rots.
- **The `RENAME_OBSERVATION` dispatch action is deleted**, replaced by
  `REVISE_OBSERVATION`. No CLI command used it; a client calling `/v1/dispatch`
  directly does.

### Under the hood

The revision history is one additive table plus a marker resolved inside the
wave each read already issues. Three repo-local agents — a product agent, an
observer and a release agent — and a skill that resolves an agent profile to its
session transcript.

## 0.3.0 — 2026-09-03

Pages stop being slow, one Principal can no longer learn what another has named
its Workstreams, and the door to *done* is named for what it does.

### Breaking

- **`crux outcome add` is now `crux problem complete`.** Recording an Outcome is
  how a Problem finishes, so the command lives on the Problem and says so.
  `crux outcome list` and `crux outcome show` are unchanged. The dispatch action
  `ADD_OUTCOME` is likewise `COMPLETE_PROBLEM`.
- **`crux browse` is gone**, with the TUI behind it. The browser is the human
  surface and the CLI is the agent's; the terminal UI was a third thing serving
  neither.

### Faster

- **Authorization resolves in one D1 round trip instead of five.** Every read
  used to pay a token join, three `users` lookups and a Workstream query in
  strict sequence before its own query began — depth is what D1 charges for, so
  an empty corpus cost the same as a full one. They are one join apart and now
  collapse into a single statement.
- **Independent reads stop waiting for each other.** Three sites awaited round
  trips in series that had no dependency between them.

### Safer

- **Workstream slugs are unique per owner, not per deployment.** A refusal used
  to tell you somebody else held that name, and minting a Principal is free — so
  the directory of other tenants' area names was enumerable. Slugs are scoped to
  their owner like every other visibility rule, which also stops one Principal
  squatting a name for everybody.
- **The Principal token file is no longer world-readable**, and says it already
  exists rather than silently overwriting.
- **Live refresh is keyed to one Principal**, so a claimed corpus no longer
  hears its own writes echo back.

### Fixed

- **A view snapshot with no state value restores cleanly** instead of throwing.
- **The homepage stops describing commands that do not exist**, and stops
  offering `/docs` to visitors who cannot read it.

### Under the hood

The TUI package and its skill are deleted; a test-collection timeout that only
ever failed in CI is fixed.

## 0.2.0 — 2026-09-03

Production stops moving on its own, and the deployment can now be asked which
version it is running.

### What you can observe

- **`GET /health` reports a `version`**, beside `status` and `db`, read from the
  bundle actually serving the request. Asking a crux deployment what it is
  running is now a question with an answer rather than an inference from the
  merge log. The `503 degraded` response carries it too — knowing which build is
  failing is the point of asking.

### Under the hood

Merging to `main` no longer deploys: production moves only when an operator runs
`/release`, which bumps the version, drafts the entry you are reading, runs the
gate, deploys, polls `/health` until it reports the version just built, and only
then tags. No GitHub workflow holds a deploy credential any more. A tag on
`origin` is therefore a release that reached production and was checked there — a
stronger claim than an exit code can make, since the one deploy failure this
project has actually met exits `0`.

## 0.1.0 — 2026-09-03

**Seed entry, written retroactively.** This records what was already live on
`crux.zabaca.com` when versioning arrived. It was never cut by `/release`, never
tagged, and never verified against `/health` — the first real release bumps past
it, and covers only what has landed since. It is here so the changelog does not
begin mid-story.

Crux is a problem registry an agent can operate, and adopting it costs nothing:
the first command mints a Principal against the public deployment and everything
you file belongs to it.

### The corpus

- **Adoption is anonymous-first.** No account, no token to paste — the first
  command that touches the corpus mints a Principal and writes it into
  `config.toml`. Every read is scoped to it, so what you see is what you filed.
- **`crux claim <email>` lifts the free allowance**, by mail. An address nobody
  here has *names* your Principal; an address that already exists is **linked**
  to it rather than merged, so a second machine joins the first without
  rewriting a single authored row.
- **An unclaimed Principal files against a 200-Observation allowance.** Past it,
  writes refuse with `CAPACITY_EXCEEDED` and the refusal carries the URL to
  claim. Reads are never gated by it.
- **Solution, Elimination and Decision are gone.** A Problem now carries
  **Attempts** — pointers to work happening in another tracker — and recording
  an **Outcome** against the Problem is what marks it done.
- **`crux search`** looks across Problem titles, descriptions and Observation
  content in every Workstream, so the Problem that already exists can be found
  before a near-twin is filed.

### At a screen

- **A Workstream page that is a drag-and-drop roadmap board**, with contextual
  dialogs that file entities and record transitions. A refused transition shows
  its code and message rather than snapping the card back in silence.
- **Pages refresh themselves.** A `crux` command in a terminal lands on the open
  page, and a page showing one Workstream ignores work in another.
- **Sign-in is a magic link**, and the browser is reachable by claiming a
  Principal rather than by a row written by hand.
- **A public homepage at `/`** that answers agents in plain text and browsers in
  HTML, plus `/llms.txt`.

### Working with agents

- **Every command that acts names its Workstream with `-w`.** There is no
  current Workstream to inherit, so two agents working in parallel cannot file
  into each other's corpus
  ([ADR-0014](docs/adr/0014-view-state-is-the-humans.md)).
- **`crux context` is gone.** Getting warm is three cheap reads — `workstream
  list`, `problem list -w <slug> --status now`, `problem show <id>` — each flat
  in the size of the corpus, rather than one digest that inlined every
  Observation behind every Problem and grew until it cost more than
  re-deriving context by hand.

### Under the hood

One Cloudflare Worker over one D1 database, deployed through zbc; transitions,
reads, token auth and every browser surface tested inside workerd against a real
D1 and the built bundle.
