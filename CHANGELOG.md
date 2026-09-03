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
