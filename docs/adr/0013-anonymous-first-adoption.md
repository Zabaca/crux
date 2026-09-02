# Adoption is anonymous-first, and the principal is the tenant

Registration is removed. First use of a deployment mints a **Principal** — a
token, not a person — which owns everything filed through it. Capacity is capped
at a number of Observations; past the cap, writes refuse and reads keep working.
**Claiming** attaches an email to a Principal by magic link (ADR-0010), lifting
the cap. A human may own many Principals.

This amends ADR-0003, which stands in every other respect: the client-server
split, the single transition layer and the absence of a local database are
unchanged. What does not survive is its tenancy claim — "the deployment *is* the
workspace — a single tenant, no entity above Workstream, no scope added to any
query." Frictionless adoption puts every anonymous adopter into one deployment,
and under that model they would all see each other's corpora. `WORKSTREAM_LIST`
is `db.select().from(workstreams)` with no scoping at all. The boundary has to
move, and it moves to the Principal: every read scopes to it.

ADR-0003 named the cost it was accepting — *"'install the plugin and go' becomes
'deploy your own crux'"* — and called it "a real loss, mitigated only by zbc
making the deploy a command rather than a project." That mitigation was never
enough. Requiring a Cloudflare account before a single Observation can be filed
is a wall in front of the cheapest, most valuable action in the product, and it
is a wall for agents as much as for people.

## Identity does not disappear; registration does

A cap has to count against something, so an ungated Crux still needs a durable
identity for whatever is being capped. Removing the invite and the email
round-trip is the change; removing the actor is not. Every `created_by_id`
foreign key stays intact, and the principle from ADR-0003 and ADR-0007 —
attributions resolve to an actor, Claude is a tool — survives with a sharper
story than before: the agent holds a Principal, and a human owns Principals.

## Claiming links; it never rewrites

An email arriving on a Principal that has no email names it. An email already
belonging to a human links the Principal to that human — `claimed_by_user_id`,
an edge — rather than merging two identities and re-pointing every row.
Tenancy then resolves to "every Principal claimed by me."

This is the move Crux already makes everywhere else. Archiving an Observation,
abandoning a Problem, superseding a Decision: each preserves the row and appends
a record instead of rewriting history. Merging would rewrite authorship on rows
that were honestly written by a different token, which is the same lie ADR-0011
refused when it declined to reassign a removed Member's entries.

It also fixes a real case rather than a hypothetical one. An agent on one
machine mints a Principal; an agent on another mints a second; the same person
claims both. Refusing the second claim strands a corpus. Linking does not.

## The cap is a nudge, not a control

The meter is Observations, because that is the entity an agent files constantly
and therefore the only one that scales with cost. Lockout refuses **writes
only**, with a stable `CAPACITY_EXCEEDED` code carrying the claim URL, so the
agent can explain the wall and offer the fix in the conversation where the wall
was hit. Reads are never blocked: refusing to show somebody the notes they
already captured breaks the one workflow that matters — reloading context into a
fresh session — and turns a growth mechanism into a grievance.

Anyone can mint unlimited Principals and collect the free allowance repeatedly.
This is stated rather than defended: it is inherent to frictionless adoption,
and closing it would mean fingerprinting or IP limits, which cost more than they
save and punish legitimate users first. Once a Principal is claimed the cap
applies to the human across all linked Principals, so claiming cannot be used to
pool allowances.

## Consequences

- **Every read grows a scoping predicate.** The unscoped reads are the
  single largest correctness risk in this change; one missed predicate is a
  cross-tenant disclosure, not a bug.
- **The first-Member bootstrap problem disappears.** A deployment with no rows
  no longer needs one written into D1 by hand, because first use creates its own
  Principal. The open chicken-and-egg case in `README.md` is closed by this.
- **Invites and Member removal keep working**, but stop being the only way in.
  ADR-0011's guarantee is unchanged for claimed identities.
- **Pricing is deliberately unresolved.** The cap exists to create a claim
  moment, not to price one. What unlocks beyond it is a later decision.
