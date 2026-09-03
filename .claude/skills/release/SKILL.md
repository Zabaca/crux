---
name: release
description: Cut a crux release — the ONLY path to production. Checks preconditions, bumps the version in apps/cloud/package.json, drafts a user-facing CHANGELOG entry for approval, runs `bun run verify`, deploys with `zbc apply production`, verifies the live version on `/health`, and only then tags and pushes. Use when asked to "release", "cut a release", "ship crux", "deploy to production", "publish a version", or "/release". Refuses rather than improvises when a precondition is not met.
disable-model-invocation: true
---

# /release — cut a crux release

**This is the only path to production.** A merge to `main` deploys nothing, and
nothing under `.github/` holds a deploy credential or may ever be given one. See
[ADR-0015](../../../docs/adr/0015-a-release-is-a-command-not-a-merge.md).

Run every step in order. **Do not skip a step, do not move the deploy in front
of the gate, and do not proceed past a refusal** — a refusal below is a stop,
not a warning. Every command runs from the repository root.

---

## Step 0 — preconditions

Run these before anything is built or written. Each has its own refusal message;
print it and **stop**.

```bash
git rev-parse --abbrev-ref HEAD
git status --porcelain
git fetch origin main
git rev-list --left-right --count origin/main...HEAD
gh run list --workflow=main.yml --branch main --limit 1 \
  --json status,conclusion,headSha,url
```

| Condition | Refuse with |
| --- | --- |
| The branch is not `main` | `Refusing: a release is cut from main, and you are on <branch>. Switch to main and re-run.` |
| `git status --porcelain` is non-empty | `Refusing: the working tree is dirty. A release must be reproducible from a commit, and these files are in neither: <files>. Commit or stash them.` |
| The right-hand count is non-zero (local commits not on origin) | `Refusing: main is ahead of origin/main by <n> commit(s). Push them and let CI judge them before releasing.` |
| The left-hand count is non-zero (origin has commits you lack) | `Refusing: main is behind origin/main by <n> commit(s). Pull first — a release must ship what everybody else can see.` |
| The newest `main.yml` run is not `status: completed` with `conclusion: success` | `Refusing: the newest Main run is <status>/<conclusion>, not green. <url>` |
| That run's `headSha` is not `HEAD` | `Refusing: the newest green Main run is for <sha>, not the commit you are releasing. Wait for CI on HEAD.` |

`gh` not being installed or authenticated is itself a refusal — the green-CI
precondition cannot be checked by hand and must not be waived:
`Refusing: cannot read CI status (gh is not available/authenticated), and the green-CI precondition is not optional.`

Then read, for the version decision:

```bash
prev=$(git describe --tags --match 'crux-v*' --abbrev=0 2>/dev/null)
range=${prev:+$prev..}HEAD                    # whole history if untagged
git log --oneline "$range"                    # what is in this release
git diff --stat "$range" -- packages/core/src/db/schema.ts packages/cli/src
```

**If there is no `crux-v*` tag at all, this is the first real release.** The
`0.1.0` entry in `CHANGELOG.md` is a *seed*: it records what was live when
versioning arrived, retroactively, and was never cut by `/release`, never
tagged, and never verified against `/health` — the entry says so itself. So the
range is the whole history, the previous version is whatever
`apps/cloud/package.json` reads (`0.1.0`), and this release **bumps past it**.
Its entry covers only what has landed since the seed was written.

---

## Step 1 — decide the version, and draft the entry

`apps/cloud/package.json` is the **only** place in this repository the release
version is written, because it is the only package that becomes the deployment
(ADR-0015). Every other `package.json` here is private, npm never sees it, and
what it says is not a claim about anything — `packages/core` and `packages/cli`
read `0.0.0`, `packages/infra` and `packages/tui-ds` read `0.0.1`. **Do not
"fix" those to match a release**, and do not read one as the version.

The shape is `MAJOR.MINOR.PATCH`, at `0.x` today:

- **MAJOR** only for a change that breaks a corpus somebody already has, or the
  CLI contract an installed plugin depends on — a removed command, a renamed
  `--json` field, a schema change the end-state DDL cannot express additively.
  That is the one thing that takes crux off `0.x`: a MAJOR bump from `0.4.2` is
  `1.0.0`, not `0.5.0`.
- **MINOR** if the range contains anything a user or agent can observe — a new
  command, a page that did not exist, a refusal that now explains itself.
- **PATCH** if the range is fixes and work under the hood.

Now draft the `CHANGELOG.md` entry, reading `git log` for the range and the
existing entry for the house style. The rule, restated because it is the whole
point of the file:

> A line earns its place by naming something a user can **observe**. Work that
> changes nothing outside this repository gets one sentence under **Under the
> hood**, at the bottom. This is not a commit log.

Every entry opens with a **single lead sentence** naming what the release is
for, before any list. Sections are `###` headings; use as many or as few as the
release needs. Remember who reads this: crux's primary user is an agent, so
"`crux problem list` gained `--status`" is an observable change and "the read
port moved into core" is not.

**Show the drafted entry and the chosen version, and stop for approval before
writing any file.** This step is not optional and has no `--yes`: prose is the
one part of a release that must not be silent. If the human wants changes,
redraft and ask again.

Once approved:

1. Bump the version — from `apps/cloud`, and never with a git tag, which is
   Step 4's job:

   ```bash
   cd apps/cloud && bun pm version <patch|minor|major> --no-git-tag-version && cd -
   ```

   `bun pm version` tags by default; the tag must not exist until production has
   confirmed the deploy. If the flag is unavailable, edit the `version` field by
   hand — do not let it create the tag.

2. Insert the entry into `CHANGELOG.md` directly under the preamble, above the
   previous release. Date it today.
3. Commit both, and nothing else — **on a branch, not on `main`**:

```bash
git switch -c release/v<X.Y.Z>
git add apps/cloud/package.json CHANGELOG.md
git commit -m "chore(release): crux v<X.Y.Z>"
git push -u origin release/v<X.Y.Z>
gh pr create --title "chore(release): crux v<X.Y.Z>" --body "<the changelog entry>"
```

**The release commit goes through a pull request like every other change.**
`main` takes changes only that way — the [`main` ruleset](../../../docs/runbooks/protect-main.md)
has no bypass actors, admins included — and a release is not the place to earn
an exception. It also means the exact commit that ships was verified by CI on
`main`, which is what Step 2 re-checks.

Wait for `Verify` to pass, merge it, and come back to `main`:

```bash
gh pr checks --watch
gh pr merge --squash --delete-branch
git switch main && git pull origin main
```

**Do not tag yet.** The tag is Step 4, after production has been asked what it
is running.

---

## Step 2 — the gate

All of it, **before** anything is deployed. A non-zero exit is a stop: report
which command failed with its output, and **do not deploy**.

First, confirm CI has judged the release commit itself — the merge in Step 1
started a fresh `main.yml` run:

```bash
git rev-parse HEAD
gh run list --workflow=main.yml --branch main --limit 1 \
  --json status,conclusion,headSha,url
```

Same refusal as Step 0 if it is not `completed`/`success` for this exact `HEAD`.
Then run the gate locally as well:

```bash
bun run scripts/build-docs.ts   # the doc tree is derived, not committed (ADR-0005)
bun run verify                  # lint, typecheck, docs:check, test
```

`verify` is defined once in `package.json` and is the same sequence
`pull-request.yml` and `main.yml` run, so the release gate cannot drift behind
the merge gate. Running it locally on top of the green CI run is not redundant
ceremony: it is the last check on the working tree the deploy will actually be
built from, and `zbc apply` builds from that tree, not from what CI had.

Two failures worth recognising rather than retrying blind:

- **`docs:check` reporting orphans or broken links** is structural doc rot and a
  real stop (ADR-0002) — a doc under `docs/` that nothing in `README.md` reaches.
  Fix the link; do not delete the doc to quiet the check.
- **A workerd suite timing out at 5000ms** has been a real flake on a loaded
  machine, and has also been a real bug. Re-run the failing file alone before
  deciding which it was, and say which in the report:
  `cd apps/cloud && bunx vitest run workers-test/<file>`.

If any of this fails: **stop, do not deploy, and do not tag.** The version bump
is already on `main` at this point and that is fine — `main` is allowed to be
ahead of production (ADR-0015), and an untagged version on `main` is precisely
how that reads. Fix the failure as an ordinary change, then run `/release`
again: since Step 0 computes its range from the last **tag**, the abandoned
version falls inside the next release's range either way. Whether that release
ships the same number or bumps past it does not matter — a version with no tag
never reached production, so nothing claims it did. Do not revert the release
commit to "clean up", and do not deploy a tree the gate rejected.

---

## Step 3 — deploy

**First, re-check `origin/main`.** Step 0's check is now several minutes stale —
a merge and a full `verify` are not fast — and what gets deployed is this working
tree. Somebody else's merge landing underneath you means the tag in Step 4 would
name a commit that is no longer the tip.

```bash
git fetch origin main
git rev-list --left-right --count origin/main...HEAD    # must read "0  0"
```

Anything else is a stop, before the deploy rather than after it:
`Refusing: origin/main moved while the gate was running (<n> new commit(s)). Pull, re-run the gate, and release from the tip — the release must ship what everybody else can see.`

Then:

```bash
bun run deploy      # bunx @zabaca/zbc apply production
```

**`bunx`, never `bunx --bun`.** wrangler on the Bun runtime exits **0** after
uploading a version while silently skipping the deploy — a green apply that
shipped nothing. zbc's cloudflare module catches that by insisting on wrangler's
own "Deployed … triggers" line, but the clean path is to let `bunx` pick the
Node runtime, which `bun run deploy` does.

`zbc apply` converges both halves in order: the `d1` instance applies the schema,
then the `cloud` instance deploys the Worker that reads it. That ordering is
enforced by an import, not by convention — deploying code ahead of its schema is
how a Worker ends up 500ing on a column that does not exist yet.

Secrets decrypt through sops/age. If that fails, the age key is probably not
where sops expects it — see README's Deploy section; it is not a reason to
improvise around the deploy.

A non-zero exit here is a stop. Nothing is tagged and nothing is pushed.

---

## Step 4 — verify, then tag, then push

**This is the step the whole design exists for.** wrangler's exit code says an
upload happened. It does not say what is now serving traffic.

```bash
curl -s https://crux.zabaca.com/health
```

Poll for up to ~60s (a deploy takes a few seconds to propagate). It must report
`"version"` equal to the version just committed, and `"status":"ok"`.

- **If `status` is `degraded`**, the Worker deployed but cannot read D1. Report
  it and stop — do not tag. That is a broken production, and the next move is
  diagnosis, not bookkeeping.
- **If the version never matches**, **do not tag and do not push.** Report what
  `/health` reports against what was expected. Production is running a commit
  that exists only on this machine, which is the situation to hand back rather
  than paper over: find out why the bundle disagrees and re-run from Step 2, or
  re-deploy from `origin/main` to put production back on a commit everybody has.
- **If it matches**, and only then:

```bash
git tag -a "crux-v<X.Y.Z>" -m "crux v<X.Y.Z>"
git push origin "crux-v<X.Y.Z>"
```

**A tag, and nothing else.** The commit is already on `origin` — it went through
a pull request in Step 1 — so this pushes no branch and needs no exception to
the `main` ruleset. **A deploy that fails verification leaves no tag on
`origin`**, which is what makes every tag a release that reached production and
was checked there.

If the tag name already exists on `origin`, **stop rather than moving it.** That
means a release with this version was already cut, and two different commits
answering to one version is the exact confusion the version exists to prevent.
Report it: either the bump in Step 1 chose a version that had already shipped,
or a previous `/release` got further than its report suggested.

---

## Step 5 — say what happened

Report, in a few lines:

- the version and the tag;
- the `/health` response that verified it;
- the changelog entry's lead sentence;
- anything in the gate that was slow, flaky, or worth a ticket — the workerd
  timeout especially, since "flaky" and "broken" look identical in one run.

The pull request from Step 1 is already merged and its branch deleted; nothing
further is open. If `main` has moved since Step 3, say so — production is
serving the tagged commit, not the tip, and that gap is the thing the next
release closes.
