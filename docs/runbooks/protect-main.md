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

From a machine authenticated as a repository admin (`gh auth status` shows a
personal account, not an app token):

```sh
gh api -X POST repos/Zabaca/crux/rulesets --input .github/main-ruleset.json
```

[`.github/main-ruleset.json`](../../.github/main-ruleset.json) is the payload:
`main` (as `~DEFAULT_BRANCH`) cannot be deleted or force-pushed, changes arrive
through a pull request, and the `Verify` status check — the job name in
`pull-request.yml`, which is what GitHub reports the check as — must pass first.
Approvals are not required: the review count is `0`, so a single maintainer is
gated on green CI rather than on finding a second pair of eyes.

To change it later, edit the file and `PUT` it back at
`repos/Zabaca/crux/rulesets/<id>`.

## Verify it

```sh
gh api repos/Zabaca/crux/rulesets --jq '.[] | {id, name, enforcement}'
gh api repos/Zabaca/crux/rules/branch/main --jq '[.[].type]'
```

The second command asks the question that actually matters — *what rules apply
to `main` right now* — and should list `pull_request` and
`required_status_checks`. A merge attempted against a red or absent `Verify`
then refuses in the UI and through `gh pr merge`.

## The one thing to watch

A required check that never reports blocks a pull request forever. `Verify` runs
on every PR targeting `main` with no path filter, so that failure mode needs the
workflow file to be deleted or renamed. If the job is ever renamed, this
ruleset's `context` has to be renamed with it in the same change.
