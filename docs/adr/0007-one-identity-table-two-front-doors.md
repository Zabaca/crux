# One identity table, two front doors

Browser sessions and CLI tokens are two ways in to the same deployment, and they
resolve to the same row. Better Auth's `user` model is pointed at the existing
`users` table — `modelName` plus a field map, with `email_verified`, `image` and
`updated_at` added to it — rather than given a table of its own. Everything else
Better Auth needs (`auth_sessions`, `auth_accounts`, `auth_verifications`) lives
in tables it owns outright.

The alternative was a separate `auth_users` table joined to `users`. We rejected
it because attribution is the product: a Decision records who decided, and the
CLI prints that name. With two identity tables, "who did this" becomes a
question with two answers that have to be kept in agreement forever, and the
first time they disagree the corpus is quietly wrong about its own history. One
table makes the agreement structural instead of maintained.

The cost is that `users` now carries columns only the browser half reads, and
that Better Auth models timestamps as `Date` while the corpus models them as
epoch milliseconds. The second is handled by `db/auth-schema.ts`, which
re-declares the same physical table with `mode: "timestamp_ms"` — two typed
lenses over one table, so the adapter gets Dates and `reads/` keeps numbers.

**Membership stays out of the schema.** There is no Workspace table, no
membership table and no role column. The deployment is the Workspace (ADR-0003),
so a row in `users` *is* a Member and an invite is a one-time permission to
create one. Consequently no read gains a scope and no page asks whether a Member
may see a Workstream — the read pages take no permission argument at all, which
is the property that makes "every Member sees every Workstream" true by
construction rather than by review.

## Consequences

- **`users` is append-only in shape.** A deployment whose `users` predates this
  gets the new columns via additive `ALTER TABLE` in `applyD1Schema`, where a
  duplicate-column error is the success case on re-run. End-state DDL alone
  (ADR-0006) cannot express "add a column to a table that already exists".
- **`users.email` is unique but nullable.** Rows the CLI seeded have no address,
  so the index is partial (`WHERE email IS NOT NULL`). A Member created by
  redeeming an invite always has one.
- **The Worker needs `BETTER_AUTH_SECRET`.** Without it the browser surfaces
  answer 503 and say so; `/health`, `/v1` and the CLI are unaffected. Password
  hashing uses scrypt from `node:crypto`, so the Worker also needs
  `nodejs_compat`.
- **Unmatched paths changed meaning.** Before the browser surfaces, anything
  outside `/health` and `/v1` was a JSON `{"error":"not_found"}` 404. Those paths
  now belong to the session gate: an anonymous request to one is redirected to
  `/signin`, and a signed-in Member gets an HTML 404 page. The `/v1` and
  `/health` contracts are untouched, but a client that probed an unknown path and
  read the JSON body will see a redirect instead. The API's own unmatched routes
  (`/v1/nope`) still answer `{"error":{"code":"NOT_FOUND"}}` as before.
- **Revocation is asymmetric, and that is intended.** Revoking a CLI token stops
  that token; it does not end browser sessions, which are ended by signing out
  or by expiry.
- **A token can only be revoked by its owner.** `revokeToken` takes the owner as
  a required argument rather than an optional filter, because the id it revokes
  arrives from a form field — an owner the caller could forget to pass is an
  owner some caller eventually forgets. Revoking a token that does not exist and
  revoking someone else's are indistinguishable to the caller.
