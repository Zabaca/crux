# A skew is a refusal, not a bad argument

A `crux` command is an HTTP call, so every working session is a client and a
deployment together, and the two move independently. When the client is ahead —
which is the only direction that can fail — it sends a `kind` the deployment has
never heard of, and the deployment answers `VALIDATION_ERROR`. That is the same
code the skill documents for omitting `-w`, so the failure reads as *you called
it wrong* and invites a repair that cannot succeed. An unrecognised `kind` now
refuses with its own code, and both halves can say which version they are.

## Why the two halves drift on purpose

Pinning the client to a deployment is only enforceable when one operator owns
both, and crux is deliberately not that. Adoption is anonymous-first against a
public deployment ([ADR-0013](0013-anonymous-first-adoption.md)); the plugin puts
the client on the user's own update schedule against a deployment they do not
control; and a merge deploys nothing
([ADR-0015](0015-a-release-is-a-command-not-a-merge.md)), so `main` sitting ahead
of production is the normal state rather than an incident. A client that refused
to run against anything but its own release would refuse for exactly the people
the install story is aimed at.

So skew is tolerated. What was missing was not prevention but diagnosis.

## What the refusal asserts

`UNKNOWN_KIND`, exit **29**, on both `/v1/query` and `/v1/dispatch` — the failure
is identical on the two surfaces, and a caller that has to branch on which
endpoint it used learns nothing from the split.

The code is named for the fact rather than the cause. Naming it
`DEPLOYMENT_OUTDATED` would be more actionable and sometimes false: both
endpoints are open HTTP, and a hand-rolled client with a typo in its `kind`
would be told the deployment is old and sent to the wrong place. The server
knows only that it does not recognise the kind, so that is what the code says;
the *message* names the likely cause — the client is ahead, and re-checking
arguments will not help — and the deployment's `version` rides in `details`.

The discrimination itself needs no new information. A Zod discriminated-union
failure at `path: ["kind"]` is structurally different from a failure inside a
matched variant, and the server already has both. What it did not have was a
branch: every `ZodError` was folded into one code.

## One version, and who tells whom

The client reads its version from `apps/cloud/package.json` — the same file
`/release` bumps and `/health` serves — resolved through `CRUX_PLUGIN_ROOT`. It
does not read `packages/cli/package.json`, which has never been bumped off
`0.0.0` and is the drift this decision exists to stop happening twice. There is
one version for the repository because the repository releases as a unit and the
plugin ships that unit.

The deployment tells the client its version, in the error that needs it. The
client does not tell the deployment anything: no header, because nothing on the
server would read one — there is no request log and no telemetry, and building
the channel before the reader is speculative. It stays additive if that changes.

Asking for the pair when nothing has failed is `crux version`, which reports both
and degrades to `deployment: null` when the deployment is unreachable.
`crux --version` stays local and never touches the network, because a version
flag that fails when you are offline fails exactly when you most need to know
what you are running. The flag's output is a strict subset of the command's, so
the difference reads as *the flag skipped the network* rather than as two
answers.

## This amends ADR-0015

That decision says `apps/cloud/package.json` is the only place in this repository
the release version is written. `/release` now bumps three files: that one,
[`plugin.json`](../../.claude-plugin/plugin.json) and
[`marketplace.json`](../../.claude-plugin/marketplace.json).

The reason is not consistency. Claude Code caches an installed plugin at
`~/.claude/plugins/cache/<owner>/<plugin>/<version>` — the version string is the
cache key — and crux's marketplace version has sat at `0.1.0` since it was
written. If updates are decided on that string, an installed plugin user's
client never updates at all while the deployment moves under them every release,
which is the most severe possible instance of the skew this ADR is about. That
inference is drawn from the cache layout of installed plugins rather than from
Claude Code's source, and it is worth confirming rather than trusting.

The alternative — setting the marketplace version to a git sha, as some plugins
do, so every merge is an update — was rejected because it ships `main` to users,
and `main` is explicitly not what production is running.

## What this does not cover

A `kind` both halves know, whose payload gained a required field, still refuses
as `VALIDATION_ERROR` and is still indistinguishable from a genuine bad argument.
Nobody has hit it. It is named here so that the next person to hit it recognises
it rather than filing it as a regression of this decision.
