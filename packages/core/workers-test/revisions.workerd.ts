/**
 * A row may be corrected, and the corpus keeps what it used to say (ADR-0017).
 *
 * Seam: `dispatch()` in, `query()` out — the two entry points every surface
 * goes through, so what is pinned here holds for the CLI and the browser alike.
 * Nothing below selects from the `revisions` table: the history is read the way
 * a caller reads it, because the storage shape is the decision most likely to
 * change and a test that asserts on it would have to change with it.
 */
import { env, reset } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";

import { dispatch } from "../src/actions/index.js";
import { resolveScope } from "../src/auth/principals.js";
import { createD1Db, type CruxDb } from "../src/db/client.js";
import { applyD1Schema } from "../src/db/d1/index.js";
import { evidence, observations, problems, users, workstreams } from "../src/db/schema.js";
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
  changed: Record<string, string | null>;
  reason: string | null;
  revisedById: string;
  revisedAt: number;
};

const historyOf = (id: number): Promise<RevisionEntry[]> =>
  query({ kind: "PROBLEM_REVISIONS", id }, { db, principal: OWNER }) as Promise<RevisionEntry[]>;

/** Any of the four history reads, phrased the same way the Problem's is. */
const historyFor = (kind: string, id: string): Promise<RevisionEntry[]> =>
  query({ kind, id } as never, { db, principal: OWNER }) as Promise<RevisionEntry[]>;

const send = (action: unknown): Promise<unknown> =>
  dispatch(action as never, {
    db,
    viewStore: new MemoryViewStore(),
    actor: OWNER,
    capacity: CAPACITY,
  });

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
// The rest of the corpus (ADR-0017): Evidence, Outcome, Abandonment,
// Workstream. Each is filed the way a caller files it — through `dispatch()` —
// so the invariants the revision must not disturb are the real ones.
// ---------------------------------------------------------------------------

/** An Observation linked to `problemId` as Evidence, with a why-note. */
async function seedEvidence(problemId: number, note: string): Promise<string> {
  await db.insert(observations).values({
    id: "OBS-001",
    workstreamId: "WS-t",
    reporterId: "USR-t",
    content: "the digest took 4s",
  });
  const { result } = (await send({
    kind: "ADD_EVIDENCE",
    payload: { observation: "OBS-001", problem: problemId, note },
  })) as { result: { id: string } };
  return result.id;
}

/** The Evidence row as its only listing answers with it. */
const evidenceRow = (problemId: number) =>
  query({ kind: "EVIDENCE_LIST", problem: problemId }, { db, principal: OWNER }) as Promise<
    { id: string; note: string | null; revision: { count: number } | null }[]
  >;

const outcomeShow = (id: string) =>
  query({ kind: "OUTCOME_SHOW", id }, { db, principal: OWNER }) as Promise<{
    observedImpact: string;
    learnings: string | null;
    revision: { count: number; lastRevisedAt: number } | null;
  }>;

const abandonmentShow = (id: string) =>
  query({ kind: "ABANDONMENT_SHOW", id }, { db, principal: OWNER }) as Promise<{
    rationale: string;
    revision: { count: number; lastRevisedAt: number } | null;
  }>;

const workstreamShow = (id: string) =>
  query({ kind: "WORKSTREAM_SHOW", id }, { db, principal: OWNER }) as Promise<{
    slug: string;
    title: string;
    description: string | null;
    revision: { count: number; lastRevisedAt: number } | null;
  }>;

const problemStatus = async (id: number): Promise<string | null> =>
  (
    (await query({ kind: "PROBLEM_SHOW", id }, { db, principal: OWNER })) as {
      status: string | null;
    }
  ).status;

describe("REVISE_EVIDENCE", () => {
  test("corrects the why-note, and the listing shows it was corrected", async () => {
    const problemId = await seedProblem();
    const id = await seedEvidence(problemId, "shows the digest is the cost");

    await send({
      kind: "REVISE_EVIDENCE",
      payload: { id, note: "measures the digest at 4s, which demotes the other cause" },
    });

    const [row] = await evidenceRow(problemId);
    expect(row!.note).toBe("measures the digest at 4s, which demotes the other cause");
    expect(row!.revision).toEqual({ count: 1, lastRevisedAt: expect.any(Number) });
    expect((await historyFor("EVIDENCE_REVISIONS", id))[0]!.changed).toEqual({
      note: "shows the digest is the cost",
    });
  });

  test("a note that was never written is kept in the history as the null it was", async () => {
    const problemId = await seedProblem();
    const id = await seedEvidence(problemId, "");
    await db.update(evidence).set({ note: null }).where(eq(evidence.id, id));

    await send({ kind: "REVISE_EVIDENCE", payload: { id, note: "why this one supports it" } });

    expect((await historyFor("EVIDENCE_REVISIONS", id))[0]!.changed).toEqual({ note: null });
  });

  test("refuses the link itself: which Observation supports which Problem is not a sentence", async () => {
    const problemId = await seedProblem();
    const id = await seedEvidence(problemId, "a note");

    await expect(
      send({ kind: "REVISE_EVIDENCE", payload: { id, observation: "OBS-002" } }),
    ).rejects.toThrow();
  });

  test("an Evidence link nobody has revised has no marker and an empty history", async () => {
    const problemId = await seedProblem();
    const id = await seedEvidence(problemId, "a note");

    expect((await evidenceRow(problemId))[0]!.revision).toBeNull();
    expect(await historyFor("EVIDENCE_REVISIONS", id)).toEqual([]);
  });
});

describe("REVISE_OUTCOME", () => {
  /** A Problem closed the only way it can be: by recording what became of it. */
  async function seedOutcome(problemId: number): Promise<string> {
    const { result } = (await send({
      kind: "COMPLETE_PROBLEM",
      payload: {
        problem: problemId,
        observedImpact: "p95 fell to 900ms",
        learnings: "the digest was the whole of it",
      },
    })) as { result: { id: string } };
    return result.id;
  }

  test("corrects the measurement and what was learned, keeping both previous values", async () => {
    const problemId = await seedProblem();
    const id = await seedOutcome(problemId);

    await send({
      kind: "REVISE_OUTCOME",
      payload: {
        id,
        observedImpact: "p95 fell to 1.4s, not 900ms — the first reading was a warm cache",
        reason: "the measurement was taken against a warmed deployment",
      },
    });

    const shown = await outcomeShow(id);
    expect(shown.observedImpact).toBe(
      "p95 fell to 1.4s, not 900ms — the first reading was a warm cache",
    );
    // Untouched, because the revision did not name it.
    expect(shown.learnings).toBe("the digest was the whole of it");
    expect(shown.revision).toEqual({ count: 1, lastRevisedAt: expect.any(Number) });

    const [entry] = await historyFor("OUTCOME_REVISIONS", id);
    expect(entry!.changed).toEqual({ observedImpact: "p95 fell to 900ms" });
    expect(entry!.reason).toBe("the measurement was taken against a warmed deployment");
  });

  test("does not reopen the Problem, and does not admit a second Outcome", async () => {
    const problemId = await seedProblem();
    const id = await seedOutcome(problemId);

    await send({ kind: "REVISE_OUTCOME", payload: { id, observedImpact: "retracted" } });

    // The prose changed; the terminal transition did not (ADR-0017).
    expect(await problemStatus(problemId)).toBe("done");
    await expect(
      send({
        kind: "COMPLETE_PROBLEM",
        payload: { problem: problemId, observedImpact: "a second measurement" },
      }),
    ).rejects.toMatchObject({ code: "ILLEGAL_TRANSITION" });
  });

  test("refuses a field no Outcome has, rather than dropping it silently", async () => {
    const problemId = await seedProblem();
    const id = await seedOutcome(problemId);

    // No `problem` and no `followUpProblemIds`: the transition is not reachable
    // from a correction.
    await expect(
      send({ kind: "REVISE_OUTCOME", payload: { id, followUpProblemIds: [1] } }),
    ).rejects.toThrow();
  });
});

describe("REVISE_ABANDONMENT", () => {
  async function seedAbandonment(problemId: number): Promise<string> {
    await send({
      kind: "ABANDON_PROBLEM",
      payload: { id: problemId, rationale: "nobody has asked for this twice" },
    });
    return `ABN-${problemId}`;
  }

  test("corrects the rationale and keeps what it used to say", async () => {
    const problemId = await seedProblem();
    const id = await seedAbandonment(problemId);

    await send({
      kind: "REVISE_ABANDONMENT",
      payload: { id, rationale: "two people asked, and neither would use what we would build" },
    });

    const shown = await abandonmentShow(id);
    expect(shown.rationale).toBe("two people asked, and neither would use what we would build");
    expect(shown.revision).toEqual({ count: 1, lastRevisedAt: expect.any(Number) });
    expect((await historyFor("ABANDONMENT_REVISIONS", id))[0]!.changed).toEqual({
      rationale: "nobody has asked for this twice",
    });
  });

  test("does not un-abandon the Problem", async () => {
    const problemId = await seedProblem();
    const id = await seedAbandonment(problemId);

    await send({ kind: "REVISE_ABANDONMENT", payload: { id, rationale: "a truer reason" } });

    expect(await problemStatus(problemId)).toBe("abandoned");
  });
});

describe("REVISE_WORKSTREAM", () => {
  test("corrects the title and the description, and keeps both previous values", async () => {
    await seedProblem();
    await db
      .update(workstreams)
      .set({ description: "everything Claude Code touches" })
      .where(eq(workstreams.id, "WS-t"));

    await send({
      kind: "REVISE_WORKSTREAM",
      payload: {
        workstream: "t",
        title: "Crux itself",
        description: "the product, not the engagements run through it",
      },
    });

    const shown = await workstreamShow("WS-t");
    expect(shown.title).toBe("Crux itself");
    expect(shown.description).toBe("the product, not the engagements run through it");
    expect(shown.revision).toEqual({ count: 1, lastRevisedAt: expect.any(Number) });
    expect((await historyFor("WORKSTREAM_REVISIONS", "WS-t"))[0]!.changed).toEqual({
      title: "T",
      description: "everything Claude Code touches",
    });
  });

  test("cannot reach the slug: it is how the row is addressed, not what it said", async () => {
    await seedProblem();

    await expect(
      send({ kind: "REVISE_WORKSTREAM", payload: { workstream: "t", slug: "crux" } }),
    ).rejects.toThrow();

    // Not merely refused — unchanged, and still reachable by the slug it had.
    expect((await workstreamShow("WS-t")).slug).toBe("t");
    expect(await historyFor("WORKSTREAM_REVISIONS", "WS-t")).toEqual([]);
  });

  test("refuses a revision that names no field, and writes nothing", async () => {
    await seedProblem();

    await expect(
      send({ kind: "REVISE_WORKSTREAM", payload: { workstream: "t" } }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(await historyFor("WORKSTREAM_REVISIONS", "WS-t")).toEqual([]);
  });

  test("another Principal's Workstream is missing, not refused", async () => {
    await seedProblem();
    await db.insert(users).values({ id: "USR-other", slug: "other", name: "Other" });

    await expect(
      dispatch(
        { kind: "REVISE_WORKSTREAM", payload: { workstream: "WS-t", title: "not yours" } },
        { db, viewStore: new MemoryViewStore(), actor: { id: "USR-other" }, capacity: CAPACITY },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("one history, every kind of row", () => {
  test("a revision on one entity is not history for another that shares its id", async () => {
    const problemId = await seedProblem();
    const evidenceId = await seedEvidence(problemId, "a note");

    await revise(problemId, { title: "a truer title" });
    await send({ kind: "REVISE_EVIDENCE", payload: { id: evidenceId, note: "a truer note" } });

    // Both live in `revisions`; `entity` is what keeps them apart.
    expect((await historyOf(problemId)).map((r) => r.changed)).toEqual([
      { title: "reads are slow" },
    ]);
    expect((await historyFor("EVIDENCE_REVISIONS", evidenceId)).map((r) => r.changed)).toEqual([
      { note: "a note" },
    ]);
  });
});
