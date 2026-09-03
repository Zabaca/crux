/**
 * A page render resolves the tenancy boundary once, and asks its independent
 * questions together.
 *
 * The browser pages used to hand `query()` a Principal and no scope, so every
 * read on the page re-resolved "what may this Principal see" — three times to
 * render the board. `pageContext` now resolves it once, beside the session, and
 * hands it down; these tests are what stop a later page from quietly dropping it
 * again, since a page that forgets is still *correct*, only slower.
 *
 * Both properties are taken at the D1 binding. A page that re-resolved the scope
 * looks identical from above, and so does one that turned a `Promise.all` back
 * into sequential awaits — the same statements, in the same order, just deeper.
 * Only the binding sees the difference.
 */
import { env, reset } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";

import { createD1Db, type CruxDb } from "@crux/core/db";
import { countingD1 } from "@crux/core/db/test-utils";
import { applyD1Schema } from "@crux/core/db/d1";
import { observations, problems, users, workstreams } from "@crux/core/db/schema";
import { resolveActiveScope, type Scope } from "@crux/core/auth/principals";

import { boardData } from "../src/web/board.js";

let db: CruxDb;

const VIEWER = "USR-viewer";

/** The scope query is the one that walks `users` under its own alias. */
const isScopeResolution = (sql: string) => sql.includes("scope_self");

beforeEach(async () => {
  await reset();
  db = createD1Db(env.DB);
  await applyD1Schema(env.DB);
  await db.insert(users).values({ id: VIEWER, slug: "viewer", name: "Viewer" });
  await db
    .insert(workstreams)
    .values({ id: "WS-crux", slug: "crux", title: "Crux", ownerId: VIEWER });
  await db.insert(problems).values({
    workstreamId: "WS-crux",
    title: "reads are slow",
    description: "five hops before anything is read",
    createdById: VIEWER,
  });
  await db.insert(observations).values({
    id: "OBS-1",
    workstreamId: "WS-crux",
    content: "a signal",
    reporterId: VIEWER,
  });
});

async function scopeForViewer(): Promise<Scope> {
  const scope = await resolveActiveScope(db, { id: VIEWER });
  expect(scope).not.toBeNull();
  return scope!;
}

describe("the board's read composition", () => {
  test("resolves the scope once for the whole render, not once per read", async () => {
    const counted = countingD1(env.DB);

    // What `pageContext` does: one statement that is both the membership check
    // and the scope, then every read on the page carries it.
    const scope = await resolveActiveScope(counted.db, { id: VIEWER });
    expect(scope).not.toBeNull();
    await boardData({ db: counted.db, principal: { id: VIEWER }, scope: scope! }, "crux");

    expect(counted.statements.filter(isScopeResolution)).toHaveLength(1);
  });

  test("its two summary reads are in flight together", async () => {
    const scope = await scopeForViewer();
    const counted = countingD1(env.DB);

    await boardData({ db: counted.db, principal: { id: VIEWER }, scope }, "crux");

    // The Workstream has to be resolved first — the summaries are keyed on its
    // id — but nothing orders the two summaries against each other.
    expect(counted.peakConcurrency()).toBeGreaterThanOrEqual(2);
    // Eight statements, five deep: the Workstream, then `PROBLEM_SUMMARIES`
    // (four) beside `OBSERVATION_SUMMARIES` (three). Serialized with the scope
    // re-resolved per read, the same page was eleven of each.
    expect(counted.statements).toHaveLength(8);
    expect(counted.statements.filter(isScopeResolution)).toHaveLength(0);
  });

  test("a slug this Principal does not own reads as missing", async () => {
    await db.insert(users).values({ id: "USR-other", slug: "other", name: "Other" });
    await db
      .insert(workstreams)
      .values({ id: "WS-theirs", slug: "theirs", title: "Theirs", ownerId: "USR-other" });

    expect(
      await boardData({ db, principal: { id: VIEWER }, scope: await scopeForViewer() }, "theirs"),
    ).toBeNull();
  });

  test("the Workstream it does own comes back whole", async () => {
    const data = await boardData(
      { db, principal: { id: VIEWER }, scope: await scopeForViewer() },
      "crux",
    );
    expect(data?.workstream.id).toBe("WS-crux");
    expect(data?.problems).toHaveLength(1);
    expect(data?.observations).toHaveLength(1);
  });
});
