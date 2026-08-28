# Removing a Member revokes access; it never deletes the identity

A Member is removed from the Workspace by stamping `users.removed_at`. The row
stays, with everything it was carrying. What ends is the way in.

Deletion was never really on the table once the schema was read out loud.
`users.id` is the target of a foreign key from `observations.reporter_id`,
`problems.created_by_id`, `evidence`, `solutions`, `eliminations`, `decisions`,
`abandonments`, `outcomes`, `workstreams.owner_id`, `api_tokens` and `invites`.
Attribution is the product (ADR-0007) — a Decision records who decided, and the
CLI prints that name — so deleting the row is either refused by the database or,
where the declarations have drifted, quietly leaves the corpus citing an author
who no longer exists. Reassigning their entries to a placeholder is worse: it
does not remove the person from the history, it lies about it.

## One column, three gates

Removal writes nothing but the stamp. No token is revoked row by row and no
session record is deleted, because every door reads the same column:

- `findMemberByEmail` — the send-time membership gate, so **no sign-in link is
  ever mailed** to a removed address. This is the same gate a never-invited
  address meets, and for the same reason: refusing after the click would make
  the deployment an open relay pointed at its own sending reputation.
- `viewerFor` (in `web/router.ts` and `web/session.ts`) — **no browser session
  resolves to a viewer**. A valid session is not yet a viewer: Better Auth
  checks the cookie, and this checks whether the person is still in the
  Workspace. It is also what makes a sign-in link already sitting in an inbox
  worthless, which deleting session rows would not have done.
- `authenticateToken` — **no CLI token authenticates**, joined in rather than
  checked by the caller, because there is exactly one thing a resolved token is
  for and a removed person may not do it.

The stamp is therefore the only thing to undo, which is what makes a re-invite a
*reinstatement*: `ensureMember` looks past a removal on purpose, clears the
stamp, and hands back the same `users.id` — history, tokens and all. The way
back in is the door they came in through.

## No roles, and no removing yourself

Membership is coarse (ADR-0003), so there is no admin to reserve this for: any
Member may remove any other. The one rule is that nobody may remove themselves,
enforced where the request lands and not merely by the absence of a button.
It is not that self-removal is dangerous in itself — it is the one removal that
can empty the Workspace, and with no roles to distinguish Members the last one
out leaves a deployment nobody can sign in to and no invite can be issued from.
Signing out is what leaving looks like.

## Consequences

- **The Members list is a query, not the table.** "Who is a Member" now means
  `removed_at IS NULL`, and every read of `users` for that purpose goes through
  `auth/membership.ts`. A new caller that selects from `users` directly will
  quietly count removed people.
- **A removed Member still appears in the corpus**, by design. Their name is on
  the Observations, Problems and Decisions they filed, and the read pages will
  keep printing it. Removal is a fact about access, not about history.
- **Reinstatement is silent.** There is no separate "restore" control and no
  notice that the address being invited was once a Member; the invite flow is
  unchanged and simply lands on the old row.
- **The column reaches an existing deployment through `D1_ADD_COLUMNS`.** A
  `users` table that predates the column takes the `ALTER`, and its rows read as
  active — an added column must not make everyone who was there before it look
  removed.
- **Removal is browser-only for now.** The CLI has no `crux member` command; it
  inherits the consequence (a removed owner's token stops working) without
  gaining the verb.
