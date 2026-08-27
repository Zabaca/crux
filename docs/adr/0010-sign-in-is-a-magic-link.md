# Sign-in is a magic link

A browser session is minted one way: the visitor asks for a link, and clicks the
one that arrives. There is no password field, and no second method kept around
for the case where mail is slow.

Passwords were the original choice because they need no infrastructure — which
was true right up until the deployment had to send exactly one kind of mail
anyway. What tipped it is that a password on this deployment secures nothing a
mailbox does not already secure: there is no password reset that does not go
through email, so the mailbox was always the real credential and the password
was a second thing to lose. Removing it removes a stored secret, a hashing
dependency (`scrypt` from `node:crypto`), a reset flow that was never built, and
a class of support request.

## Membership is checked before the mail is sent, not after

Better Auth's magic-link plugin has a `disableSignUp` option, and it is set —
but it is enforced when a link is *verified*. Left at that, `POST /sign-in/magic-link`
would mail a sign-in link to any address on the internet that asked for one and
refuse it only after the click. A public form that sends mail to arbitrary
addresses is an open relay pointed at the deployment's own sending reputation.

So the router asks first: `findMemberByEmail` decides whether anything is sent
at all, and `disableSignUp` stays on underneath as the second answer to the same
question. Membership is a row in `users` (ADR-0003, ADR-0007), so this is not a
new rule — it is the existing one, asked at the moment it can still prevent
something.

## The reply never varies by address

Every sign-in attempt renders the same page: *if that address belongs to a
Member, a link is on its way*. Not "no such Member", and not a different status
code, because the form is reachable by anyone and the Member list is not
public — an answer that varied would turn the sign-in form into a membership
oracle for the whole Workspace.

The cost is real and is accepted: someone who typos their address gets the same
page as someone who did not, and finds out only when no mail arrives. The page
says so, which is the most that can be said without saying too much.

## Consequences

- **An invite creates the `users` row; it no longer creates a credential.**
  `claimUserByEmail` is gone, along with the idea of a row that exists but
  cannot be signed in as. Every row in `users` with an email address is now a
  Member who can sign in, which is what made a migrated row usable again — and
  is why creating a row is exactly as privileged as granting access, and only an
  invite may do it.
- **Redeeming an invite ends at "check your email", not at a session.** It costs
  a click and buys the property that sessions have one origin. The invite token
  proves the link was received; the sign-in link proves the inbox is still
  theirs, which is the thing a session should actually rest on.
- **The deployment cannot issue sessions without a mail sender.** `RESEND_API_KEY`
  and `EMAIL_FROM` join `BETTER_AUTH_SECRET` in the set of things whose absence
  turns the browser surfaces off while leaving `/health`, `/v1` and the CLI
  working. The sign-in page says which one is missing rather than failing
  opaquely.
- **Links are stored hashed and spent once.** `storeToken: "hashed"` matches the
  CLI tokens and the invite tokens: a leaked corpus yields no usable links. A
  link lasts 15 minutes.
- **The suite never sends mail.** `createAuth` takes the sender as a parameter,
  so core's tests pass a capturing function; the Worker's tests stub the Resend
  endpoint through miniflare's `outboundService`, which fails any *other*
  outbound request so a new one cannot appear unnoticed.
- **CLI tokens are untouched.** They are minted from a session and authenticate
  `/v1` on their own; how the session was obtained was never part of that.
