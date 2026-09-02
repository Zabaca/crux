# Cloud crux is client-server and cloud-only

Crux moves off a single machine. The goal is two things the local tool cannot do: read and write the corpus from anywhere, and collaborate with teammates invited into the workspace. The deployment *is* the workspace — a single tenant, no entity above Workstream, no scope added to any query. Members of a deployment see all of its Workstreams; a group that should not share a corpus gets its own deployment.

> **The tenancy claim in that paragraph is amended by
> [ADR-0013](0013-anonymous-first-adoption.md).** The tenant is now the
> Principal, and every read is scoped to it. The rest of this ADR — the
> client-server split, the single transition layer, no local database — stands.

The architecture is pure client-server. One cloud database, and every client — the CLI and the browser alike — reaches it through the API. There is no local database in the product, and no Turso embedded replicas, despite that having been the stated plan for team mode.

We chose this over local-first-with-sync because of the founding principle: transitions are code, not documentation. With replicas, each teammate's machine runs the invariant checks against a possibly-stale replica; two people can each pass locally and both write, leaving the database in a state no transition would have allowed. Client-server puts the transition layer in exactly one place, which is the only way the promise survives collaboration. Embedded replicas also require handing every teammate a full-access database token — unscopable, unrevokable in practice, and usable to write raw rows straight past the transition layer.

For the same reason there is no dual-mode fallback. A CLI that can still execute transitions locally means the invariant layer runs in two places and every future entity change lands twice. Crux is an MVP with essentially one user, so this is the cheapest moment it will ever be to collapse to a single path.

Authentication is Better Auth in the browser and minted bearer tokens for the CLI. The `users` table and `createdById` already exist, so a token resolving to a human keeps attribution working unchanged — Claude remains a tool, not an actor.

## Consequences

- **Offline stops working, and commands gain a round trip.** Accepted: crux commands fire at conversational pause points, not in hot loops, and a failed command is a more honest failure than silent divergence discovered a week later.
- **The local file database survives only as a dev and test fixture**, never as a product mode. `CRUX_DEV` keeps its meaning for development; it is no longer a way for a user to run crux.
- **Adoption changes shape.** "Install the plugin and go" becomes "deploy your own crux." That is a real loss, mitigated only by zbc making the deploy a command rather than a project.
- **Invite is not a permission system.** Membership is coarse by design: every member sees everything in the deployment. This works for teammates and does *not* work for clients. Per-Workstream visibility, if ever needed, is a future decision, not an oversight.
- **The existing corpus migrates once** into the cloud database, with the original file kept frozen on disk as a backup.
