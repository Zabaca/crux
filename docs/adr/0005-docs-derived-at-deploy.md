# Docs derived at deploy in the cloud

ADR-0002 defines documentation as whatever is reachable from README, derived on read with no artifact. A Cloudflare Worker has no working tree to read, so the cloud deployment derives the doc tree at build time instead: the same walker runs during the build, its output ships inside the bundle, and rot fails the deploy. Locally — `bun run docs:check` and the dev server — derived-on-read is unchanged. One walker either way.

This amends ADR-0002 rather than contradicting it. What that decision rejected was an artifact that could drift *from its source*: a committed `/docs` someone forgot to regenerate. An artifact rebuilt by the same walker from the same commit on every deploy cannot drift, and the actual guarantee — that the check and the rendered page run identical code over identical input — survives intact.

The alternative of fetching README and its links from the GitHub API at request time was rejected: it buys marginal freshness in exchange for a runtime dependency on GitHub, a token to manage, and rate limits.

## Consequences

- **Cloud docs describe the deployed commit, not `main`.** Arguably what a reader wants; either way the staleness window is bounded by deploy frequency, not by whether someone remembered to regenerate.
- **Rot becomes a gate rather than a suggestion.** This is a strict improvement over `docs:check` as a script no one is obliged to run.
- **A broken link can now block a deploy.** Accepted deliberately — that is the mechanism, not a side effect.
- **ADR-0002 stays in force locally.** The two modes differ in *when* derivation happens, never in what "reachable" means.
