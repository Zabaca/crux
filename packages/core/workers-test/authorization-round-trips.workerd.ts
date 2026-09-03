/**
 * Authorization costs one round trip, and the count is the test.
 *
 * "Who is asking and what may they see" used to be five statements, each
 * awaiting the one before it: the token join, three lookups on `users`, and the
 * Workstreams. Depth is what D1 charges for — the corpus can be empty and the
 * bill is the same — so the property worth pinning is not that the answer is
 * right (the scoping and claims suites already pin that) but that arriving at it
 * takes exactly one statement.
 *
 * The count is taken at the D1 binding rather than at drizzle, because a
 * refactor that reintroduced a sequential walk would do it above the binding and
 * still look like one call from anywhere higher up.
 */
import { env, reset } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";

import { createD1Db, type CruxDb } from "../src/db/client.js";
import { applyD1Schema } from "../src/db/d1/index.js";
import { users, workstreams } from "../src/db/schema.js";
import { mintToken } from "../src/auth/tokens.js";
import { authenticateAndResolveScope, resolveScope } from "../src/auth/principals.js";
import { query } from "../src/reads/index.js";

let db: CruxDb;

/** A D1 binding that records every statement prepared against it. */
function counting(binding: D1Database): { db: CruxDb; statements: string[] } {
  const statements: string[] = [];
  const proxy = new Proxy(binding, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "prepare") {
        return (sql: string) => {
          statements.push(sql);
          return (value as D1Database["prepare"]).call(target, sql);
        };
      }
      if (prop === "batch") {
        return (list: D1PreparedStatement[]) => (value as D1Database["batch"]).call(target, list);
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { db: createD1Db(proxy), statements };
}

beforeEach(async () => {
  await reset();
  db = createD1Db(env.DB);
  await applyD1Schema(env.DB);
});

/** A Principal with a Workstream, and optionally claimed by `claimedBy`. */
async function principal(tag: string, claimedBy?: string): Promise<string> {
  const id = `USR-${tag}`;
  await db.insert(users).values({
    id,
    slug: tag,
    name: tag,
    claimedByUserId: claimedBy ?? null,
    claimedAt: claimedBy ? Date.now() : null,
  });
  await db.insert(workstreams).values({ id: `WS-${tag}`, slug: tag, title: tag, ownerId: id });
  return id;
}

describe("resolving a Principal and its scope", () => {
  test("the bearer-token door costs one statement", async () => {
    const id = await principal("solo");
    const token = (await mintToken(db, { userId: id })).token;

    const { db: counted, statements } = counting(env.DB);
    const authed = await authenticateAndResolveScope(counted, token);

    expect(statements).toHaveLength(1);
    expect(authed?.principal.id).toBe(id);
    expect(authed?.scope.workstreamIds).toEqual(["WS-solo"]);
    expect(authed?.scope.ownerIds).toEqual([id]);
  });

  test("the browser-session door costs one statement, with no token row", async () => {
    const id = await principal("viewer");

    const { db: counted, statements } = counting(env.DB);
    const scope = await resolveScope(counted, { id });

    expect(statements).toHaveLength(1);
    expect(scope.workstreamIds).toEqual(["WS-viewer"]);
  });

  test("a claimed set is still one statement, however many are linked", async () => {
    const root = await principal("root");
    await principal("linked-a", root);
    await principal("linked-b", root);
    const token = (await mintToken(db, { userId: "USR-linked-a" })).token;

    const { db: counted, statements } = counting(env.DB);
    const authed = await authenticateAndResolveScope(counted, token);

    expect(statements).toHaveLength(1);
    expect(authed?.scope.ownerIds.sort()).toEqual(["USR-linked-a", "USR-linked-b", "USR-root"]);
    expect(authed?.scope.workstreamIds.sort()).toEqual(["WS-linked-a", "WS-linked-b", "WS-root"]);
    // The one id in the scope that is not a set. The view-state Durable Object
    // is addressed by `idFromName`, so a linked Principal has to resolve to the
    // root's object or it pushes where nobody is listening (ADR-0014).
    expect(authed?.scope.rootId).toBe(root);
  });

  test("an unclaimed Principal is its own root", async () => {
    const id = await principal("alone");
    const token = (await mintToken(db, { userId: id })).token;

    expect((await authenticateAndResolveScope(db, token))?.scope.rootId).toBe(id);
    expect((await resolveScope(db, { id })).rootId).toBe(id);
  });
});

describe("the read the API actually serves", () => {
  test("a handed-down scope is not re-resolved", async () => {
    const id = await principal("handed-down");
    const token = (await mintToken(db, { userId: id })).token;
    const authed = (await authenticateAndResolveScope(db, token))!;

    const { db: counted, statements } = counting(env.DB);
    await query(
      { kind: "WORKSTREAM_LIST" },
      { db: counted, principal: authed.principal, scope: authed.scope },
    );

    // Only the read's own statement. The API resolves identity and scope in one
    // statement at the edge; a `query()` that resolved its own would put the
    // round trip straight back.
    expect(statements).toHaveLength(1);
  });

  test("a scope belonging to somebody else is ignored, not trusted", async () => {
    const mine = await principal("mine");
    const theirs = await principal("theirs");
    const stolen = await resolveScope(db, { id: theirs });

    const result = (await query(
      { kind: "WORKSTREAM_LIST" },
      { db, principal: { id: mine }, scope: stolen },
    )) as Array<{ id: string }>;

    expect(result.map((w) => w.id)).toEqual(["WS-mine"]);
  });
});

describe("what the collapsed query still refuses", () => {
  test("a token whose owner was removed does not authenticate at all", async () => {
    const id = await principal("gone");
    const token = (await mintToken(db, { userId: id })).token;
    await db.update(users).set({ removedAt: Date.now() }).where(eq(users.id, id));

    expect(await authenticateAndResolveScope(db, token)).toBeNull();
  });

  test("a removed root takes the whole linked set with it", async () => {
    const root = await principal("dead-root");
    await principal("survivor", root);
    const token = (await mintToken(db, { userId: "USR-survivor" })).token;
    await db.update(users).set({ removedAt: Date.now() }).where(eq(users.id, root));

    // Still authenticated — the Principal itself is a Member — and scoped to
    // nothing, which is what keeps removal from being undone by a claim edge.
    const authed = await authenticateAndResolveScope(db, token);
    expect(authed?.principal.id).toBe("USR-survivor");
    expect(authed?.scope.ownerIds).toEqual([]);
    expect(authed?.scope.workstreamIds).toEqual([]);
    // And it falls back to itself rather than to the dead root, so the object
    // it reads view-state from is one nobody else resolves to.
    expect(authed?.scope.rootId).toBe("USR-survivor");
  });

  test("a removed linked Principal drops out of the set", async () => {
    const root = await principal("live-root");
    await principal("removed-link", root);
    await db.update(users).set({ removedAt: Date.now() }).where(eq(users.id, "USR-removed-link"));
    const token = (await mintToken(db, { userId: root })).token;

    const authed = await authenticateAndResolveScope(db, token);
    expect(authed?.scope.ownerIds).toEqual([root]);
    expect(authed?.scope.workstreamIds).toEqual(["WS-live-root"]);
  });

  test("a Principal id naming no row scopes to nothing, not to a dangling id", async () => {
    // The browser door resolves an id out of a session, and a session can
    // outlive the row it names. An empty scope is the answer; a scope built
    // around the id itself would be a corpus nobody owns.
    const scope = await resolveScope(db, { id: "USR-never-existed" });
    expect(scope.ownerIds).toEqual([]);
    expect(scope.workstreamIds).toEqual([]);
    expect(scope.rootId).toBe("USR-never-existed");
    expect(scope.has("WS-anything")).toBe(false);
  });

  test("a revoked token stops resolving", async () => {
    const id = await principal("revoked");
    const token = (await mintToken(db, { userId: id })).token;
    await env.DB.prepare("update api_tokens set revoked_at = ?").bind(Date.now()).run();

    expect(await authenticateAndResolveScope(db, token)).toBeNull();
  });

  test("an unknown token resolves to nothing", async () => {
    await principal("someone");
    expect(await authenticateAndResolveScope(db, "crux_not_a_real_token")).toBeNull();
    expect(await authenticateAndResolveScope(db, null)).toBeNull();
  });
});
