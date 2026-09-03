# A Workstream slug belongs to its owner, not to the deployment

`workstreams.slug` was unique across the deployment while every other
visibility rule was per-Principal. It is now unique per owner, and the
Workstream id — which was `WS-<slug>` — is opaque, because a primary key
derived from the slug _is_ a deployment-wide unique index on it.

This settles a question ADR-0013 left open. That decision moved the tenancy
boundary to the Principal and said every read scopes to it; the slug namespace
was the one thing left global, and it was left there deliberately — the second
anonymous adopter to reach for `crux` was told the name was "taken on this
deployment" rather than handed a raw constraint failure as a 500 on their first
command.

## What that cost

**It was an existence oracle.** Minting a Principal is unauthenticated and
free, so anybody could ask, one slug at a time, what other tenants had named
their areas — and a slug is a meaningful area name, so what leaked was client
and product names. Everywhere else this was already right: selecting another
Principal's Workstream is refused in the same words as one that never existed.
The slug path was the single place the oracle survived.

**It let one Principal squat the namespace.** Capacity meters Observations
only, so nothing bounds how many Workstreams a Principal creates. A global
namespace plus free identities plus an unmetered write is a permanent land-grab
for the cost of a few requests.

Against that, the clear error it bought is worth very little: the collision it
described is not the caller's to resolve, and the only advice it could offer was
to pick a different name for a reason it should never have known.

## What changed

- The unique index moves from `(slug)` to `(owner_id, slug)`. The old index is
  dropped by the schema application rather than merely no longer created —
  leaving it would keep enforcing exactly what this replaces.
- New ids are `WS-<16 hex>`. Rows written before this keep their `WS-<slug>`
  ids, which is harmless precisely because nothing reads an id for its slug.
- Renaming a Workstream no longer rewrites its primary key, so the deferred-FK
  batch that carried every referrer across is gone. A rename touches one row.
- Slug resolution is filtered to the caller's scope _before_ it picks a row. An
  unscoped `limit(1)` would now be able to answer with a stranger's Workstream,
  or refuse the caller their own.
- The only collision that can be reported is one inside the caller's own scope,
  and the words say so: _you already have a Workstream slugged "x"_.

## Consequences

A slug no longer identifies a Workstream on its own — only a slug plus a scope
does. Inside one scope it still can name two rows, because claiming links
Principals that may each already own that name (ADR-0013), and no write can
merge or rename them. Resolution is therefore made deterministic rather than
refused: the requester's own Principal wins, then the lowest id. New duplicates
cannot be created, since both `ADD_WORKSTREAM` and `RENAME_WORKSTREAM` refuse a
slug anything in the visible scope already holds.
