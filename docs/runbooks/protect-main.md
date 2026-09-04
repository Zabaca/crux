# Require the pull-request check on `main`

[`pull-request.yml`](../../.github/workflows/pull-request.yml) makes a branch's
verification *visible* before a merge. This runbook is the other half: making it
**required**, so a merge cannot land while the check is red or missing.

The two halves are separable on purpose — the workflow is code and ships with
the repository, while the rule lives in GitHub's configuration and has to be
applied once, by a human with admin rights on `Zabaca/crux`. The bot token CI
and the agents use is an installation token without the `administration`
permission, so it cannot write this; the API answers `403 Resource not
accessible by integration`.

## Apply it

From the repo root, on a machine authenticated as a repository admin
(`gh auth status` shows a personal account, not an app token):

```sh
gh api -X POST repos/Zabaca/crux/rulesets --input .github/main-ruleset.json
```

[`.github/main-ruleset.json`](../../.github/main-ruleset.json) is the payload:
`main` (as `~DEFAULT_BRANCH`) cannot be deleted or force-pushed, changes arrive
through a pull request, and the `Verify` status check — the job name in
`pull-request.yml`, which is what GitHub reports the check as — must pass first.
Approvals are not required: the review count is `0`, so a single maintainer is
gated on green CI rather than on finding a second pair of eyes. The check is
pinned to `integration_id` 15368 — GitHub Actions — so a green `Verify` has to
come from the workflow, not from a commit status anyone with write access could
post under the same name.

There is exactly one `bypass_actor`: the **repository admin role**, `always`.
It exists for one caller and one commit — [`/release`](../../.claude/skills/release/SKILL.md)
pushes its version bump and changelog entry straight to `main`
([ADR-0015](../adr/0015-a-release-is-a-command-not-a-merge.md)). That commit is
two mechanical files carrying no reviewable decision: a version string a tool
wrote, and prose a human approved at the keyboard a moment earlier. Sending it
through a pull request bought a second `Verify` on content `main.yml` was about
to check again anyway. **The bypass skips the pull request, not CI** — the
release refuses to deploy until `main.yml` is green on that exact commit, so
nothing reaches production unverified.

The exemption is deliberately the *role*, not a person or an app: the release is
cut from an operator's machine by whoever holds admin, and CI holds no
credential that could use it. Everything else still arrives through a pull
request, admins included in spirit — the bypass is a door for one commit shape,
not a habit. Widen it only with a reason worth writing down here.

Two things it does not cover. `zbc apply production` reads the trunk and does
not write it, and [rebuilding the database](rebuild-production-database.md) runs
from an operator's machine — neither touches `main`. And the release's **tag**
needs no bypass at all, because this ruleset targets branches; a tag ruleset
added later would be the thing that breaks releases.

To change it later, edit the file and `PUT` it back at
`repos/Zabaca/crux/rulesets/<id>`.

## Verify it

```sh
gh api repos/Zabaca/crux/rulesets --jq '.[] | {id, name, enforcement}'
gh api repos/Zabaca/crux/rules/branch/main --jq '[.[].type]'
gh api repos/Zabaca/crux/rulesets/<id> --jq '.bypass_actors'
```

The second command asks the question that actually matters — *what rules apply
to `main` right now* — and should list `pull_request` and
`required_status_checks`. A merge attempted against a red or absent `Verify`
then refuses in the UI and through `gh pr merge`.

The third is the half a release depends on, and it is worth reading rather than
assuming: it must show `RepositoryRole` with `bypass_mode: always`. An empty
list means `/release`'s Step 1 push will be rejected. Note that `rules/branch`
resolves rules *for the caller* — an admin may see a shorter list precisely
because the bypass is working, so check both.

## The one thing to watch

A required check that never reports blocks a pull request forever, and there are
three ways to get there:

- **The job is renamed.** The required `context` is the job's `name` in
  `pull-request.yml`. Rename one, rename the other, in the same change.
- **The default branch is renamed.** This ruleset follows it (`~DEFAULT_BRANCH`),
  but `pull-request.yml`'s `branches: [main]` does not — the trigger would stop
  firing while the requirement kept applying.
- **A first-time contributor opens a fork PR.** Actions holds the run until a
  maintainer clicks *Approve and run workflows*; the check sits pending rather
  than failing, which reads like a hang.
