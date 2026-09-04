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
import { attempts, observations, problems, users, workstreams } from "../src/db/schema.js";
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

// ---------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------

/** An Observation to correct, in the same Workstream the Problem above lives in. */
async function seedObservation(archived = false): Promise<string> {
  await db.insert(users).values({ id: "USR-t", slug: "t", name: "T" });
  await db.insert(workstreams).values({ id: "WS-t", slug: "t", title: "T", ownerId: "USR-t" });
  await db.insert(observations).values({
    id: "OBS-001",
    workstreamId: "WS-t",
    reporterId: "USR-t",
    content: "the digest takes 4 seconds",
    ...(archived
      ? { archivedAt: Date.now(), archivedById: "USR-t", archiveRationale: "the digest is gone" }
      : {}),
  });
  return "OBS-001";
}

const reviseObs = (id: string, fields: { content?: string; reason?: string }): Promise<unknown> =>
  dispatch(
    { kind: "REVISE_OBSERVATION", payload: { id, ...fields } },
    { db, viewStore: new MemoryViewStore(), actor: OWNER, capacity: CAPACITY },
  );

const obsHistoryOf = (id: string): Promise<RevisionEntry[]> =>
  query({ kind: "OBSERVATION_REVISIONS", id }, { db, principal: OWNER }) as Promise<
    RevisionEntry[]
  >;

const obsShowOf = (id: string) =>
  query({ kind: "OBSERVATION_SHOW", id }, { db, principal: OWNER }) as Promise<{
    content: string;
    archivedAt: number | null;
    revision: { count: number; lastRevisedAt: number } | null;
  }>;

describe("REVISE_OBSERVATION", () => {
  test("corrects the content and keeps what it used to say", async () => {
    const id = await seedObservation();

    await reviseObs(id, { content: "the digest takes 12 seconds", reason: "I misread the trace" });

    const shown = await obsShowOf(id);
    expect(shown.content).toBe("the digest takes 12 seconds");
    expect(shown.revision).toEqual({ count: 1, lastRevisedAt: expect.any(Number) });

    const [entry] = await obsHistoryOf(id);
    expect(entry!.changed).toEqual({ content: "the digest takes 4 seconds" });
    expect(entry!.reason).toBe("I misread the trace");
    expect(entry!.revisedById).toBe("USR-t");
  });

  test("refuses a revision whose content is the one already there", async () => {
    const id = await seedObservation();

    await expect(reviseObs(id, { content: "the digest takes 4 seconds" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });

    expect(await obsHistoryOf(id)).toEqual([]);
  });

  test("an archived Observation is still revisable, and stays archived", async () => {
    // The two claims are orthogonal (ADR-0017): archiving says the row stopped
    // being live, revision says it was wrong. A retired row is still reachable
    // by id and under any Problem's Evidence, so a falsehood in one still
    // informs a live conclusion and is worth correcting.
    const id = await seedObservation(true);

    await reviseObs(id, { content: "the digest took 12 seconds" });

    const shown = await obsShowOf(id);
    expect(shown.content).toBe("the digest took 12 seconds");
    expect(shown.archivedAt).toEqual(expect.any(Number));
  });

  test("another Principal's Observation is missing, not refused", async () => {
    const id = await seedObservation();
    await db.insert(users).values({ id: "USR-other", slug: "other", name: "Other" });

    await expect(
      dispatch(
        { kind: "REVISE_OBSERVATION", payload: { id, content: "not yours" } },
        { db, viewStore: new MemoryViewStore(), actor: { id: "USR-other" }, capacity: CAPACITY },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const stranger = await resolveScope(db, { id: "USR-other" });
    await expect(
      query(
        { kind: "OBSERVATION_REVISIONS", id },
        { db, principal: { id: "USR-other" }, scope: stranger },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ---------------------------------------------------------------------------
// Attempts
// ---------------------------------------------------------------------------

/** An Attempt against a seeded Problem, open unless it is asked to be closed. */
async function seedAttempt(closed = false): Promise<string> {
  const problemId = await seedProblem();
  await db.insert(attempts).values({
    id: "ATT-001",
    problemId,
    ref: "https://tracker.example/WRONG-1",
    label: "cache the digest",
    createdById: "USR-t",
    ...(closed ? { status: "shipped", closingNote: "landed in v3" } : {}),
  });
  return "ATT-001";
}

type AttemptFields = { ref?: string; label?: string; closingNote?: string; reason?: string };

const reviseAtt = (id: string, fields: AttemptFields): Promise<unknown> =>
  dispatch(
    { kind: "REVISE_ATTEMPT", payload: { id, ...fields } },
    { db, viewStore: new MemoryViewStore(), actor: OWNER, capacity: CAPACITY },
  );

const attHistoryOf = (id: string): Promise<RevisionEntry[]> =>
  query({ kind: "ATTEMPT_REVISIONS", id }, { db, principal: OWNER }) as Promise<RevisionEntry[]>;

const attListed = async (id: string) => {
  const rows = (await query({ kind: "ATTEMPT_LIST" }, { db, principal: OWNER })) as Array<{
    id: string;
    ref: string;
    label: string;
    status: string;
    closingNote: string | null;
    revision: { count: number; lastRevisedAt: number } | null;
  }>;
  return rows.find((r) => r.id === id)!;
};

describe("REVISE_ATTEMPT", () => {
  test("corrects a ref without touching the status — a correction is not a transition", async () => {
    const id = await seedAttempt();
    expect((await attListed(id)).status).toBe("open");

    await reviseAtt(id, {
      ref: "https://tracker.example/RIGHT-1",
      reason: "the first ref resolved to nothing",
    });

    const row = await attListed(id);
    expect(row.ref).toBe("https://tracker.example/RIGHT-1");
    // The repair this replaces was closing it `dropped` and refiling, which
    // left a dropped Attempt representing no abandoned work (ADR-0017).
    expect(row.status).toBe("open");
    expect(row.closingNote).toBeNull();
    expect((await attHistoryOf(id))[0]!.changed).toEqual({
      ref: "https://tracker.example/WRONG-1",
    });
  });

  test("corrects a label alone, and leaves the ref exactly as it was", async () => {
    const id = await seedAttempt();

    await reviseAtt(id, { label: "cache the board query" });

    const row = await attListed(id);
    expect(row.label).toBe("cache the board query");
    expect(row.ref).toBe("https://tracker.example/WRONG-1");
  });

  test("corrects the closing note of a closed Attempt, and it stays closed", async () => {
    const id = await seedAttempt(true);

    await reviseAtt(id, { closingNote: "landed in v3.1, behind a flag" });

    const row = await attListed(id);
    expect(row.closingNote).toBe("landed in v3.1, behind a flag");
    expect(row.status).toBe("shipped");
    expect((await attHistoryOf(id))[0]!.changed).toEqual({ closingNote: "landed in v3" });
  });

  test("refuses a closing note on an Attempt that is still open", async () => {
    // There is nothing to correct, and writing one would close the Attempt
    // through a door that records no judgment.
    const id = await seedAttempt();

    await expect(reviseAtt(id, { closingNote: "invented" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });

    const row = await attListed(id);
    expect(row.status).toBe("open");
    expect(row.closingNote).toBeNull();
    expect(await attHistoryOf(id)).toEqual([]);
  });

  test("refuses a revision that names no field, and one that changes nothing", async () => {
    const id = await seedAttempt();

    await expect(reviseAtt(id, {})).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(reviseAtt(id, { label: "cache the digest" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });

    expect(await attHistoryOf(id)).toEqual([]);
  });

  test("refuses correcting a ref to nothing, the way filing one does", async () => {
    const id = await seedAttempt();

    await expect(reviseAtt(id, { ref: "   " })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });

    expect((await attListed(id)).ref).toBe("https://tracker.example/WRONG-1");
  });

  test("the marker rides the listing, and the history is the second read", async () => {
    const id = await seedAttempt();
    await reviseAtt(id, { ref: "https://tracker.example/RIGHT-1" });
    await reviseAtt(id, { label: "cache the board query" });

    const marker = (await attListed(id)).revision;
    expect(marker!.count).toBe(2);
    expect(marker!.lastRevisedAt).toBe((await attHistoryOf(id))[0]!.revisedAt);
  });

  test("another Principal's Attempt is missing, not refused", async () => {
    const id = await seedAttempt();
    await db.insert(users).values({ id: "USR-other", slug: "other", name: "Other" });

    await expect(
      dispatch(
        { kind: "REVISE_ATTEMPT", payload: { id, ref: "https://not.yours/1" } },
        { db, viewStore: new MemoryViewStore(), actor: { id: "USR-other" }, capacity: CAPACITY },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("RENAME_OBSERVATION is gone", () => {
  test("the action set no longer accepts it", async () => {
    const id = await seedObservation();

    // It overwrote `content` with no history and no reason, and was reachable
    // from no surface at all — the exact shape revision replaces (ADR-0017).
    await expect(
      dispatch(
        { kind: "RENAME_OBSERVATION", payload: { id, content: "silently overwritten" } } as never,
        { db, viewStore: new MemoryViewStore(), actor: OWNER, capacity: CAPACITY },
      ),
    ).rejects.toThrow();

    expect((await obsShowOf(id)).content).toBe("the digest takes 4 seconds");
  });
});
