# A release is a command, not a merge

Merging to `main` deployed to production. It no longer does: `.github/`
holds no deploy credential, and production moves only when somebody runs
`/release` — which bumps a version, writes a changelog entry, deploys, asks the
deployment what it is running, and only then tags. This amends the "merging to
`main` deploys" arrangement described in ADR-0004's stack and enforced by the
old `production.yml`.

## Why the merge was the wrong trigger

Every merge shipped, and nothing afterwards could be asked what had shipped.

**Nothing could be asked what was live.** `/health` answered
`{"status":"ok","db":"ok"}`. That says a Worker is up. It does not say *which*
Worker, so the only way to know what production was running was to trust that
the last apply came from the commit you thought it did. Every `package.json` in
the workspace read `0.0.0` or `0.0.1` — correctly, since they are private and
npm never sees them — so there was no version to ask for either. Meanwhile the
one deploy failure this repository has already met in the wild is precisely a
silent one: wrangler under the Bun runtime exits 0 after uploading a version
while skipping the deploy. zbc catches that specific case by insisting on
wrangler's own "Deployed … triggers" line, which is one known failure caught at
the source — not a general answer to *is the thing I just built the thing now
serving traffic*.

**There was nothing to point a person at.** `git log` exists and is a good
commit log, which is exactly what makes it a bad changelog:
`feat: Attempt: record work happening elsewhere against a Problem` and
`docs: Crux becomes a problem registry` are adjacent lines of equal weight in
it, and only one of them is a thing anybody outside this repository can perceive.

**And a deploy could not be gated on judgment.** A merge is a decision about a
change; a deploy is a decision about a moment. Binding them meant every merge
was also a decision to ship, taken by whoever clicked the button, with no step
at which somebody could say *not yet* without also saying *don't merge*. That is
tolerable for one person merging their own work and stops being tolerable the
moment several agents are opening pull requests in parallel, which is the
direction ADR-0014 has already taken this product.

The obvious fix for the first two is a version and a changelog written by CI on
merge. That is the thing ruled out, because it leaves the third untouched and
buys the version at the cost of making the deploy even more automatic.

## Decision

**`/release` is the only path to production.** It lives at
[`.claude/skills/release/SKILL.md`](../../.claude/skills/release/SKILL.md) and
it is a skill rather than a shell script because half of it is judgment —
choosing the version, writing prose a person will read, and reading a smoke
failure honestly — and the other half is a sequence that must not be reordered.

**Nothing under `.github/` may hold a deploy credential.** `main.yml` and
`pull-request.yml` both run `bun run verify` and neither can reach
`secrets.yaml`. The `SOPS_AGE_KEY` Actions secret is the credential this ADR
takes out of CI's hands; a workflow that wants it back is proposing to overturn
this decision and should amend this document instead.

**The version lives in `apps/cloud/package.json`, and nowhere else.** That is
the one package in the workspace that becomes the deployment, so its version
field is the only one about which a claim can be made. Vite inlines it into the
Worker bundle through a JSON import, and `/health` serves it beside `status` and
`db`. The other packages stay at whatever they read today: a second place to
write the version is a place for it to drift, and `bun pm version` in the wrong
directory is an easy way to create one.

**`/health` is what verifies a deploy, not wrangler's exit code.** The release
polls it until it reports the version just committed. It has to be the
deployment answering — an exit code describes an upload, and the failure worth
catching is the one where the upload succeeded and the deploy did not.

**The tag is written last, and only after that check passes.** `crux-v<X.Y.Z>`,
pushed together with the release commit. A deploy that fails verification leaves
no tag on `origin`, which is what makes every tag on `origin` a release that
reached production and was checked there. The `crux-v` prefix leaves room for a
second deployable in this repository without a renaming.

**A changelog entry earns its place by naming something a user can observe.**
Work that changes nothing anybody outside this repository can see gets one
sentence under **Under the hood**, at the bottom.

## Consequences

- **`main` can sit ahead of production**, deliberately. "What is deployed?" is
  now a question with an answer — `curl https://crux.zabaca.com/health` — rather
  than an inference from the merge log. The cost is that the answer can be *not
  the newest commit*, which was never expressible before and is the point.
- **A merge is cheaper and a deploy is dearer.** Merging now costs a verify;
  shipping costs the gate plus a human reading a changelog draft. That is the
  right way round for a product whose pull requests are increasingly opened by
  agents.
- **`main.yml` exists only to make releases possible.** Its verify duplicates
  the pull request's, which would be pointless if the two judged the same thing;
  they do not, because the pull request judges the merge-base result and this
  judges what `main` became. `/release` refuses unless the newest run of it is
  green for the exact commit being released.
- **`/health`'s response shape changed**, and the workerd suite pins it. A
  client parsing it strictly would break; the CLI does not read it.
- **The first release bumps past `0.1.0`.** That version is a seed: it records
  what was live when this decision was taken, retroactively, and was never cut
  by `/release`, never tagged, and never verified against `/health`. The
  changelog entry says so itself.
- **The rebuild runbook is unchanged and still human-gated.** It was never in
  CI, and a database wipe is not a release.
