/**
 * A Problem may be corrected, and the corpus keeps what it used to say
 * (ADR-0017).
 *
 * Seam: `dispatch()` in, `query()` out — the two entry points every surface
 * goes through, so what is pinned here holds for the CLI and the browser alike.
 * Nothing below selects from the `revisions` table: the history is read the way
 * a caller reads it, because the storage shape is the decision most likely to
 * change and a test that asserts on it would have to change with it.
 */
import { env, reset } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";

import { dispatch } from "../src/actions/index.js";
import { resolveScope } from "../src/auth/principals.js";
import { createD1Db, type CruxDb } from "../src/db/client.js";
import { applyD1Schema } from "../src/db/d1/index.js";
import { problems, users, workstreams } from "../src/db/schema.js";
import { query } from "../src/reads/index.js";
import { MemoryViewStore } from "../src/view-state/store.js";

let db: CruxDb;

const OWNER = { id: "USR-t" };
const CAPACITY = { observationCap: 200, claimUrl: "https://crux.example/claim" };

/** A Problem to correct, filed by the Principal every test below reads as. */
async function seedProblem(): Promise<number> {
  await db.insert(users).values({ id: "USR-t", slug: "t", name: "T" });
  await db.insert(workstreams).values({ id: "WS-t", slug: "t", title: "T", ownerId: "USR-t" });
  const [p] = await db
    .insert(problems)
    .values({
      workstreamId: "WS-t",
      title: "reads are slow",
      description: "the digest inlines every Observation",
      createdById: "USR-t",
    })
    .returning({ id: problems.id });
  return p!.id;
}

type ReviseFields = { title?: string; description?: string; reason?: string };

function revise(id: number, fields: ReviseFields): Promise<unknown> {
  return dispatch(
    { kind: "REVISE_PROBLEM", payload: { id, ...fields } },
    { db, viewStore: new MemoryViewStore(), actor: OWNER, capacity: CAPACITY },
  );
}

type RevisionEntry = {
  id: string;
  changed: Record<string, string>;
  reason: string | null;
  revisedById: string;
  revisedAt: number;
};

const historyOf = (id: number): Promise<RevisionEntry[]> =>
  query({ kind: "PROBLEM_REVISIONS", id }, { db, principal: OWNER }) as Promise<RevisionEntry[]>;

const showOf = (id: number) =>
  query({ kind: "PROBLEM_SHOW", id }, { db, principal: OWNER }) as Promise<{
    title: string;
    description: string;
    revision: { count: number; lastRevisedAt: number } | null;
  }>;

beforeEach(async () => {
  await reset();
  db = createD1Db(env.DB);
  await applyD1Schema(env.DB);
});

describe("REVISE_PROBLEM", () => {
  test("changes only the field it was given, and leaves the other alone", async () => {
    const id = await seedProblem();

    await revise(id, { title: "getting warm costs a digest of everything" });

    const shown = await showOf(id);
    expect(shown.title).toBe("getting warm costs a digest of everything");
    expect(shown.description).toBe("the digest inlines every Observation");
  });

  test("refuses a revision that names no field, and writes nothing", async () => {
    const id = await seedProblem();

    await expect(revise(id, {})).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(await historyOf(id)).toEqual([]);
    expect((await showOf(id)).title).toBe("reads are slow");
  });

  test("refuses a revision whose values are the ones already there", async () => {
    const id = await seedProblem();

    await expect(revise(id, { title: "reads are slow" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });

    expect(await historyOf(id)).toEqual([]);
  });

  test("refuses a field no Problem has, rather than dropping it silently", async () => {
    const id = await seedProblem();

    // `.strict()` on the payload: accepting `content` and storing nothing is
    // exactly the "input accepted, not honoured" failure ADR-0017 refuses.
    await expect(
      dispatch(
        { kind: "REVISE_PROBLEM", payload: { id, content: "an Observation's field" } },
        { db, viewStore: new MemoryViewStore(), actor: OWNER, capacity: CAPACITY },
      ),
    ).rejects.toThrow();
  });

  test("another Principal's Problem is missing, not refused", async () => {
    const id = await seedProblem();
    await db.insert(users).values({ id: "USR-other", slug: "other", name: "Other" });

    await expect(
      dispatch(
        { kind: "REVISE_PROBLEM", payload: { id, title: "not yours" } },
        {
          db,
          viewStore: new MemoryViewStore(),
          actor: { id: "USR-other" },
          capacity: CAPACITY,
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const stranger = await resolveScope(db, { id: "USR-other" });
    await expect(
      query(
        { kind: "PROBLEM_REVISIONS", id },
        { db, principal: { id: "USR-other" }, scope: stranger },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("what the Problem used to say", () => {
  test("the history carries the previous values, the author, the time and the reason", async () => {
    const id = await seedProblem();

    await revise(id, {
      title: "getting warm costs a digest of everything",
      description: "the digest inlines every Observation behind every Problem",
      reason: "the Evidence measured the cause and demoted it",
    });

    const [entry, ...rest] = await historyOf(id);
    expect(rest).toEqual([]);
    expect(entry!.changed).toEqual({
      title: "reads are slow",
      description: "the digest inlines every Observation",
    });
    expect(entry!.reason).toBe("the Evidence measured the cause and demoted it");
    expect(entry!.revisedById).toBe("USR-t");
    expect(entry!.revisedAt).toBeGreaterThan(0);
  });

  test("a reason is optional, and its absence is recorded as one", async () => {
    const id = await seedProblem();
    await revise(id, { title: "corrected without saying why" });
    expect((await historyOf(id))[0]!.reason).toBeNull();
  });

  test("revising twice keeps both, newest first, each holding what it replaced", async () => {
    const id = await seedProblem();

    await revise(id, { title: "second" });
    await revise(id, { title: "third" });

    const history = await historyOf(id);
    expect(history.map((r) => r.changed.title)).toEqual(["second", "reads are slow"]);
    expect((await showOf(id)).title).toBe("third");
  });

  test("a Problem nobody has revised has no marker and an empty history", async () => {
    const id = await seedProblem();

    expect((await showOf(id)).revision).toBeNull();
    expect(await historyOf(id)).toEqual([]);
  });

  test("the marker counts the corrections and dates the last one", async () => {
    const id = await seedProblem();
    await revise(id, { title: "second" });
    await revise(id, { title: "third" });

    const marker = (await showOf(id)).revision;
    expect(marker!.count).toBe(2);
    expect(marker!.lastRevisedAt).toBe((await historyOf(id))[0]!.revisedAt);
  });
});
