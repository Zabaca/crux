import { env, reset } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";

import { createD1Db, type CruxDb } from "../src/db/client.js";
import { applyD1Schema } from "../src/db/d1/index.js";
import {
  createDecision,
  createElimination,
  markProblemDone,
  recordOutcome,
  renameWorkstream,
  shipSolution,
} from "../src/transitions/index.js";
import { observations, problems, solutions, users, workstreams } from "../src/db/schema.js";

// Seam: the transition functions, each of which already takes a `CruxDb`. The
// point of running them here rather than under bun is that the code executes
// inside workerd against a real D1 binding — "the invariants hold on D1" is a
// claim about the runtime that will serve them, not about a proxy to it.
//
// Expected values are the rules as ADR/README state them ("you can't file a
// Decision against a chosen Solution", "no Outcome without a shipped
// Solution"), asserted as error codes from src/transitions/errors.ts.

let db: CruxDb;

/** A Problem with two Solutions, both `proposed`. Returns their ids. */
async function seedProblemWithTwoSolutions(): Promise<{
  problemId: number;
  a: number;
  b: number;
}> {
  await db.insert(users).values({ id: "USR-t", slug: "t", name: "T" });
  await db.insert(workstreams).values({ id: "WS-t", slug: "t", title: "T", ownerId: "USR-t" });
  const [p] = await db
    .insert(problems)
    .values({ workstreamId: "WS-t", title: "P", description: "D", createdById: "USR-t" })
    .returning({ id: problems.id });
  const inserted = await db
    .insert(solutions)
    .values([
      { problemId: p!.id, title: "A", createdById: "USR-t" },
      { problemId: p!.id, title: "B", createdById: "USR-t" },
    ])
    .returning({ id: solutions.id });
  return { problemId: p!.id, a: inserted[0]!.id, b: inserted[1]!.id };
}

beforeEach(async () => {
  await reset();
  await applyD1Schema(env.DB);
  db = createD1Db(env.DB);
});

describe("Decision", () => {
  test("commits the chosen Solution and records the losers", async () => {
    const { problemId, a, b } = await seedProblemWithTwoSolutions();

    await createDecision(
      {
        id: "DEC-001",
        problemId,
        chosenSolutionId: a,
        rejectedSolutionIds: [b],
        rationale: "a is simpler",
        decidedById: "USR-t",
      },
      db,
    );

    const rows = await db.select().from(solutions);
    const byId = new Map(rows.map((r) => [r.id, r.status]));
    expect(byId.get(a)).toBe("chosen");
    expect(byId.get(b)).toBe("rejected");
  });

  test("refuses a Solution that already belongs to another Problem", async () => {
    const { a, b } = await seedProblemWithTwoSolutions();
    const [other] = await db
      .insert(problems)
      .values({ workstreamId: "WS-t", title: "P2", description: "D", createdById: "USR-t" })
      .returning({ id: problems.id });

    await expect(
      createDecision(
        {
          id: "DEC-001",
          problemId: other!.id,
          chosenSolutionId: a,
          rejectedSolutionIds: [b],
          rationale: "wrong problem",
          decidedById: "USR-t",
        },
        db,
      ),
    ).rejects.toMatchObject({ code: "REFERENTIAL_MISMATCH" });

    expect(
      await db
        .select()
        .from(solutions)
        .then((r) => r.map((s) => s.status)),
    ).toEqual(["proposed", "proposed"]);
  });

  test("refuses to choose a Solution that is already chosen", async () => {
    const { problemId, a, b } = await seedProblemWithTwoSolutions();
    await createDecision(
      {
        id: "DEC-001",
        problemId,
        chosenSolutionId: a,
        rejectedSolutionIds: [],
        rationale: "r",
        decidedById: "USR-t",
      },
      db,
    );

    await expect(
      createDecision(
        {
          id: "DEC-002",
          problemId,
          chosenSolutionId: a,
          rejectedSolutionIds: [b],
          rationale: "again",
          decidedById: "USR-t",
        },
        db,
      ),
    ).rejects.toMatchObject({ code: "INVARIANT_VIOLATION" });
  });
});

describe("Elimination", () => {
  test("cannot eliminate a Solution that has shipped", async () => {
    const { problemId, a, b } = await seedProblemWithTwoSolutions();
    await createDecision(
      {
        id: "DEC-001",
        problemId,
        chosenSolutionId: a,
        rejectedSolutionIds: [],
        rationale: "r",
        decidedById: "USR-t",
      },
      db,
    );
    await shipSolution(a, db);

    await expect(
      createElimination(
        {
          id: "ELIM-001",
          problemId,
          eliminatedSolutionIds: [a, b],
          rationale: "too late",
          eliminatedById: "USR-t",
        },
        db,
      ),
    ).rejects.toMatchObject({ code: "INVARIANT_VIOLATION" });

    // All-or-nothing: `b` was eliminable, but the batch refused as a unit.
    const rows = await db.select().from(solutions);
    expect(new Map(rows.map((r) => [r.id, r.status])).get(b)).toBe("proposed");
  });
});

describe("Outcome", () => {
  test("cannot be recorded against a Solution that has not shipped", async () => {
    const { problemId, a } = await seedProblemWithTwoSolutions();
    await createDecision(
      {
        id: "DEC-001",
        problemId,
        chosenSolutionId: a,
        rejectedSolutionIds: [],
        rationale: "r",
        decidedById: "USR-t",
      },
      db,
    );

    await expect(
      recordOutcome(
        { id: "OUT-001", solutionId: a, observedImpact: "none yet", createdById: "USR-t" },
        db,
      ),
    ).rejects.toMatchObject({ code: "INVARIANT_VIOLATION" });
  });

  test("is recorded once a Solution ships, and only once", async () => {
    const { problemId, a } = await seedProblemWithTwoSolutions();
    await createDecision(
      {
        id: "DEC-001",
        problemId,
        chosenSolutionId: a,
        rejectedSolutionIds: [],
        rationale: "r",
        decidedById: "USR-t",
      },
      db,
    );
    await shipSolution(a, db);

    await recordOutcome(
      { id: "OUT-001", solutionId: a, observedImpact: "worked", createdById: "USR-t" },
      db,
    );

    await expect(
      recordOutcome(
        { id: "OUT-002", solutionId: a, observedImpact: "again", createdById: "USR-t" },
        db,
      ),
    ).rejects.toMatchObject({ code: "INVARIANT_VIOLATION" });
  });
});

describe("Workstream rename", () => {
  test("carries every referrer to the new id", async () => {
    const { problemId } = await seedProblemWithTwoSolutions();
    await db.insert(observations).values({
      id: "OBS-001",
      workstreamId: "WS-t",
      reporterId: "USR-t",
      content: "a signal",
    });

    const result = await renameWorkstream("t", "renamed", { title: "Renamed" }, db);

    expect(result).toMatchObject({ oldId: "WS-t", newId: "WS-renamed", newSlug: "renamed" });
    const [ws] = await db.select().from(workstreams);
    expect(ws).toMatchObject({ id: "WS-renamed", slug: "renamed", title: "Renamed" });
    const [obs] = await db.select().from(observations);
    expect(obs!.workstreamId).toBe("WS-renamed");
    const [prob] = await db.select().from(problems);
    expect(prob!.workstreamId).toBe("WS-renamed");
    expect(prob!.id).toBe(problemId);
  });

  test("refuses a slug that is already taken, changing nothing", async () => {
    await seedProblemWithTwoSolutions();
    await db.insert(workstreams).values({ id: "WS-taken", slug: "taken", title: "Taken" });

    await expect(renameWorkstream("t", "taken", {}, db)).rejects.toMatchObject({
      code: "ILLEGAL_TRANSITION",
    });

    const ids = (await db.select().from(workstreams)).map((w) => w.id).sort();
    expect(ids).toEqual(["WS-t", "WS-taken"]);
  });
});

describe("Problem", () => {
  test("cannot be marked done with no shipped Solution", async () => {
    const { problemId } = await seedProblemWithTwoSolutions();

    await expect(markProblemDone(problemId, db)).rejects.toMatchObject({
      code: "INVARIANT_VIOLATION",
    });
  });

  test("is done once its chosen Solution ships", async () => {
    const { problemId, a } = await seedProblemWithTwoSolutions();
    await createDecision(
      {
        id: "DEC-001",
        problemId,
        chosenSolutionId: a,
        rejectedSolutionIds: [],
        rationale: "r",
        decidedById: "USR-t",
      },
      db,
    );
    await shipSolution(a, db);

    await markProblemDone(problemId, db);

    const [p] = await db.select().from(problems);
    expect(p!.status).toBe("done");
  });
});
