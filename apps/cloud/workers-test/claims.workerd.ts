/**
 * Claiming a Principal (ADR-0013), pinned through the deployed request path.
 *
 * `SELF.fetch` is the seam for the same reason the capacity suite uses it: what
 * a claim *is* only exists above HTTP — a POST that mails a link, a page that
 * confirms it, and the corpus that one person can suddenly read across two
 * machines. None of that is a property of a function in `auth/claims.ts`.
 *
 * The one thing done below HTTP is `createClaim`, to get the plaintext token
 * out. The mail leaves the isolate and only its hash is stored, so there is
 * nothing to read a link back out of — the same reason `web.workerd.ts` mints
 * invites in-process and then redeems them over HTTP. Requesting a claim is
 * still covered through `POST /v1/claims`; what that endpoint cannot hand back
 * is the secret it just mailed.
 */
import { env, SELF, reset } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";

import { createD1Db, type CruxDb } from "@crux/core/db";
import { applyD1Schema } from "@crux/core/db/d1";
import { observations, problems, users } from "@crux/core/db/schema";
import { claims } from "@crux/core/db/auth-schema";
import { createClaim, MAX_OUTSTANDING_CLAIMS } from "@crux/core/auth/claims";
import { mintToken } from "@crux/core/auth";
import { removeMember } from "@crux/core/auth/membership";
// Statically, not `await import(...)` inside a test: better-auth is a large
// graph and loading it takes seconds inside workerd. A dynamic import charges
// that once, to whichever test happens to reach it first, against that test's
// own timeout — which is a five-second budget spent on module loading and a
// flake on a loaded CI runner. Imported here it is paid during collection.
import { createAuth } from "@crux/core/auth/better-auth";

const BASE = "https://crux.example";
const CAP = Number(env.CRUX_OBSERVATION_CAP);

let db: CruxDb;

beforeEach(async () => {
  await reset();
  db = createD1Db(env.DB);
  await applyD1Schema(env.DB);
});

function as(bearer: string, path: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}
const dispatchAs = (bearer: string, action: unknown) =>
  as(bearer, "/v1/dispatch", { method: "POST", body: JSON.stringify(action) });
const queryAs = (bearer: string, q: unknown) =>
  as(bearer, "/v1/query", { method: "POST", body: JSON.stringify(q) });

/** Post a form the way the browser does, without following redirects. */
function postForm(path: string, fields: Record<string, string>): Promise<Response> {
  return SELF.fetch(`${BASE}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}

type Principal = { token: string; id: string; slug: string };

/** A Principal minted the way a machine with no configuration does, owning one
 * Workstream with one Observation and one Problem filed under it. */
async function principal(slug: string): Promise<Principal> {
  const res = await SELF.fetch(`${BASE}/v1/principals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const minted = (await res.json()) as { token: string; principal: { id: string } };
  const token = minted.token;
  await dispatchAs(token, { kind: "ADD_WORKSTREAM", payload: { slug, title: slug } });
  await dispatchAs(token, {
    kind: "ADD_OBSERVATION",
    payload: { workstream: slug, content: `${slug} signal` },
  });
  await dispatchAs(token, {
    kind: "ADD_PROBLEM",
    payload: { workstream: slug, title: `${slug} problem`, description: "d" },
  });
  return { token, id: minted.principal.id, slug };
}

/** Walk a claim all the way through the browser: the link, then the button. */
async function claimThroughBrowser(
  principalId: string,
  email: string,
  name?: string,
): Promise<Response> {
  const claim = await createClaim(db, { principalId, email });
  const shown = await SELF.fetch(`${BASE}/claim?token=${claim.token}`, { redirect: "manual" });
  expect(shown.status, "the mailed link renders a confirmation").toBe(200);
  expect(await shown.text()).toContain(email);
  return postForm("/claim/accept", { token: claim.token, ...(name ? { name } : {}) });
}

/** Every authorship stamp in the corpus, as one comparable value. */
async function authorship(): Promise<string> {
  const obs = await db
    .select({ id: observations.id, reporterId: observations.reporterId })
    .from(observations);
  const probs = await db
    .select({ id: problems.id, createdById: problems.createdById })
    .from(problems);
  return JSON.stringify({
    observations: obs.sort((a, b) => a.id.localeCompare(b.id)),
    problems: probs.sort((a, b) => a.id - b.id),
  });
}

async function userRow(id: string) {
  return (await db.select().from(users).where(eq(users.id, id)).limit(1))[0]!;
}

describe("asking to claim", () => {
  test("POST /v1/claims records the ask and answers 202 without writing the edge", async () => {
    const p = await principal("asking");
    const res = await as(p.token, "/v1/claims", {
      method: "POST",
      body: JSON.stringify({ email: "Dana@Example.com" }),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      // Normalised, so the click matches the ask.
      email: "dana@example.com",
      principalId: p.id,
    });

    const pending = await db.select().from(claims);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.claimedAt).toBeNull();
    // Only the mailbox learns the token. A response that carried it would make
    // the whole round-trip decorative.
    expect(JSON.stringify(body)).not.toContain("clm_");

    // The whole point of the round-trip: nothing on the Principal has moved
    // until the address is proved.
    const row = await userRow(p.id);
    expect(row.email).toBeNull();
    expect(row.claimedByUserId).toBeNull();
  });

  test("an address that is not one is refused before anything is mailed", async () => {
    const p = await principal("typo");
    const res = await as(p.token, "/v1/claims", {
      method: "POST",
      body: JSON.stringify({ email: "not-an-address" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
    expect(await db.select().from(claims)).toHaveLength(0);
  });

  test("a Principal that is claimed already cannot be claimed again", async () => {
    const p = await principal("twice");
    expect((await claimThroughBrowser(p.id, "first@example.com")).status).toBe(200);

    const res = await as(p.token, "/v1/claims", {
      method: "POST",
      body: JSON.stringify({ email: "second@example.com" }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "ALREADY_EXISTS" },
    });
  });

  test("an unauthenticated claim is refused — the token is what says which Principal", async () => {
    const res = await SELF.fetch(`${BASE}/v1/claims`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.com" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("a new address names the Principal", () => {
  test("the row itself grows the address, and the allowance stops applying", async () => {
    const p = await principal("named");
    const before = await authorship();

    const res = await claimThroughBrowser(p.id, "dana@example.com", "Dana");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Claimed");

    const row = await userRow(p.id);
    expect(row.email).toBe("dana@example.com");
    expect(row.name).toBe("Dana");
    expect(row.claimedByUserId, "a named Principal is its own human").toBeNull();
    expect(row.claimedAt).not.toBeNull();

    // No second identity was minted for the address.
    expect(await db.select().from(users)).toHaveLength(1);
    // And nothing it filed moved.
    expect(await authorship()).toBe(before);

    // Past the wall it was heading for.
    for (let i = 0; i < CAP + 1; i++) {
      const filed = await dispatchAs(p.token, {
        kind: "ADD_OBSERVATION",
        payload: { workstream: p.slug, content: `past the wall ${i}` },
      });
      expect(filed.status).toBe(200);
    }
  });

  test("no name given falls back to the address rather than staying Anonymous", async () => {
    const p = await principal("unnamed");
    expect((await claimThroughBrowser(p.id, "kim@example.com")).status).toBe(200);
    expect((await userRow(p.id)).name).toBe("kim");
  });
});

describe("a known address links rather than merges", () => {
  test("the second Principal points at the first, and neither corpus is rewritten", async () => {
    const first = await principal("first-machine");
    const second = await principal("second-machine");
    expect((await claimThroughBrowser(first.id, "dana@example.com", "Dana")).status).toBe(200);

    const before = await authorship();
    const res = await claimThroughBrowser(second.id, "dana@example.com");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("linked");

    const linked = await userRow(second.id);
    expect(linked.claimedByUserId).toBe(first.id);
    // The address stays on exactly one row: linking is an edge, not a copy.
    expect(linked.email).toBeNull();
    const withAddress = (await db.select().from(users)).filter(
      (u) => u.email === "dana@example.com",
    );
    expect(withAddress.map((u) => u.id)).toEqual([first.id]);

    expect(await authorship(), "a claim rewrites no authorship").toBe(before);
  });

  test("the human reads both corpora, and nothing from a Principal they do not own", async () => {
    const first = await principal("mine-a");
    const second = await principal("mine-b");
    const stranger = await principal("theirs");
    await claimThroughBrowser(first.id, "dana@example.com", "Dana");
    await claimThroughBrowser(second.id, "dana@example.com");

    // The human is the first Principal's row; a token for it is the same
    // identity a browser session resolves to (ADR-0007).
    const human = await mintToken(db, { userId: first.id, name: "browser" });
    const listed = await queryAs(human.token, { kind: "WORKSTREAM_LIST" });
    expect(listed.status).toBe(200);
    const slugs = ((await listed.json()) as { result: Array<{ slug: string }> }).result
      .map((w) => w.slug)
      .sort();
    expect(slugs).toEqual(["mine-a", "mine-b"]);

    // Symmetric: the linked machine's token now reads the human's corpus too.
    const fromSecond = await queryAs(second.token, { kind: "WORKSTREAM_LIST" });
    expect(
      ((await fromSecond.json()) as { result: Array<{ slug: string }> }).result
        .map((w) => w.slug)
        .sort(),
    ).toEqual(["mine-a", "mine-b"]);

    // And the stranger is still alone with theirs.
    const theirs = await queryAs(stranger.token, { kind: "WORKSTREAM_LIST" });
    expect(
      ((await theirs.json()) as { result: Array<{ slug: string }> }).result.map((w) => w.slug),
    ).toEqual(["theirs"]);
  });

  test("the linked Principal is uncapped by the human, not by an address of its own", async () => {
    const human = await principal("holder");
    const machine = await principal("worker");
    await claimThroughBrowser(human.id, "dana@example.com", "Dana");
    await claimThroughBrowser(machine.id, "dana@example.com");
    expect((await userRow(machine.id)).email, "the linked row has no address").toBeNull();

    // Enough to bury an unclaimed Principal's allowance twice over. Metering
    // runs over the whole linked set (`Scope.ownerIds`), which is exactly why
    // claiming cannot be used to pool allowances: two claimed Principals are
    // one meter, not two.
    for (let i = 0; i < CAP * 2 + 1; i++) {
      const filed = await dispatchAs(machine.token, {
        kind: "ADD_OBSERVATION",
        payload: { workstream: machine.slug, content: `bulk ${i}` },
      });
      expect(filed.status).toBe(200);
    }
  });
});

describe("the claim link itself", () => {
  test("is single-use", async () => {
    const p = await principal("once");
    const claim = await createClaim(db, { principalId: p.id, email: "dana@example.com" });
    expect((await postForm("/claim/accept", { token: claim.token })).status).toBe(200);

    const again = await postForm("/claim/accept", { token: claim.token });
    expect(again.status).toBe(410);
    expect(await again.text()).toContain("not valid");
  });

  test("expires", async () => {
    const p = await principal("stale");
    const claim = await createClaim(db, { principalId: p.id, email: "dana@example.com" });
    await db
      .update(claims)
      .set({ expiresAt: Date.now() - 1 })
      .where(eq(claims.id, claim.id));

    expect((await SELF.fetch(`${BASE}/claim?token=${claim.token}`)).status).toBe(410);
    expect((await postForm("/claim/accept", { token: claim.token })).status).toBe(410);
    expect((await userRow(p.id)).email).toBeNull();
  });

  test("a token nobody issued claims nothing", async () => {
    const p = await principal("forged");
    expect((await postForm("/claim/accept", { token: "clm_deadbeef" })).status).toBe(410);
    expect((await userRow(p.id)).email).toBeNull();
  });

  test("/claim with no token says where claiming starts, without a session", async () => {
    const res = await SELF.fetch(`${BASE}/claim`, { redirect: "manual" });
    expect(res.status, "the capped agent's URL must not bounce to sign-in").toBe(200);
    expect(await res.text()).toContain("crux claim");
  });
});

describe("what claiming refuses to reach", () => {
  test("an address whose Member was removed is not a Principal to link to", async () => {
    // ADR-0011: removal ends the way in. Minting a fresh Principal and claiming
    // it to the old address would be a new one.
    const gone = await principal("was-a-member");
    await claimThroughBrowser(gone.id, "dana@example.com", "Dana");
    expect(await removeMember(db, { userId: gone.id })).toBe(true);

    const fresh = await principal("back-again");
    const res = await claimThroughBrowser(fresh.id, "dana@example.com");
    expect(res.status).toBe(409);
    expect((await userRow(fresh.id)).claimedByUserId).toBeNull();
  });

  test("removing a human takes the corpus of everything linked to them with it", async () => {
    const root = await principal("root");
    const linked = await principal("linked");
    await claimThroughBrowser(root.id, "dana@example.com", "Dana");
    await claimThroughBrowser(linked.id, "dana@example.com");
    expect(await removeMember(db, { userId: root.id })).toBe(true);

    // The linked row is not itself removed, so its token still authenticates —
    // and must see nothing, or removal would be undone by an edge.
    const res = await queryAs(linked.token, { kind: "WORKSTREAM_LIST" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { result: unknown[] }).result).toEqual([]);
  });

  test("a linked Principal cannot be claimed again — edges never chain", async () => {
    const root = await principal("chain-root");
    const middle = await principal("chain-middle");
    await claimThroughBrowser(root.id, "dana@example.com", "Dana");
    await claimThroughBrowser(middle.id, "dana@example.com");

    const res = await as(middle.token, "/v1/claims", {
      method: "POST",
      body: JSON.stringify({ email: "someone-else@example.com" }),
    });
    expect(res.status).toBe(409);
    expect((await userRow(middle.id)).claimedByUserId).toBe(root.id);
  });

  test("a second link opened after the first is refused, with the corpus untouched", async () => {
    // Both links are minted while the Principal is still claimable, so
    // `createClaim`'s gate lets both through — the re-check inside `applyClaim`
    // is the one doing the work here.
    const p = await principal("two-links");
    const a = await createClaim(db, { principalId: p.id, email: "first@example.com" });
    const b = await createClaim(db, { principalId: p.id, email: "second@example.com" });

    expect((await postForm("/claim/accept", { token: a.token })).status).toBe(200);
    const second = await postForm("/claim/accept", { token: b.token });
    expect(second.status).toBe(409);
    expect((await userRow(p.id)).email).toBe("first@example.com");
  });

  test("a Principal may only have a few claim links in the air at once", async () => {
    const p = await principal("flooder");
    for (let i = 0; i < MAX_OUTSTANDING_CLAIMS; i++) {
      const ok = await as(p.token, "/v1/claims", {
        method: "POST",
        body: JSON.stringify({ email: `victim-${i}@example.com` }),
      });
      expect(ok.status).toBe(202);
    }
    const refused = await as(p.token, "/v1/claims", {
      method: "POST",
      body: JSON.stringify({ email: "victim-n@example.com" }),
    });
    expect(refused.status).toBe(409);
    expect(await db.select().from(claims)).toHaveLength(MAX_OUTSTANDING_CLAIMS);
  });
});

describe("after a claim names a Principal", () => {
  test("the address can sign in, which is what makes the browser reachable", async () => {
    const p = await principal("signs-in");
    expect((await claimThroughBrowser(p.id, "dana@example.com", "Dana")).status).toBe(200);

    // The row has to be verified and addressable for the magic link to mint a
    // session at all — `disableSignUp` refuses an address without a row.
    let link: string | undefined;
    const auth = createAuth(db, {
      secret: "test-secret-not-used-in-production",
      baseURL: BASE,
      sendEmail: async (message) => {
        link = message.text.match(/https?:\/\/\S+/)?.[0];
      },
    });
    await auth.api.signInMagicLink({
      body: { email: "dana@example.com", callbackURL: "/" },
      headers: new Headers(),
    });
    expect(link, "a claimed address is mailable").toBeDefined();
    const verified = await auth.api.magicLinkVerify({
      query: { token: new URL(link!).searchParams.get("token")! },
      headers: new Headers(),
      asResponse: true,
    });
    const cookie = verified.headers
      .getSetCookie()
      .map((c) => c.split(";")[0]!)
      .join("; ");
    // With the Accept a browser sends: `/` answers plain text to a caller that
    // does not ask for HTML, so omitting it here would land on the agent
    // document and never exercise the session at all.
    const home = await SELF.fetch(`${BASE}/`, {
      redirect: "manual",
      headers: { cookie, accept: "text/html,application/xhtml+xml" },
    });
    expect(home.status, "the session lands on the Workstream list, not the sign-in page").toBe(200);
    expect(await home.text()).toContain("signs-in");
  });
});
