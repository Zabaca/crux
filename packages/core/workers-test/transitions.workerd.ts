import { env, reset } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";

import { createD1Db, type CruxDb } from "../src/db/client.js";
import { applyD1Schema } from "../src/db/d1/index.js";
import { renameWorkstream } from "../src/transitions/index.js";
import { observations, problems, users, workstreams } from "../src/db/schema.js";

// Seam: the transition functions, each of which already takes a `CruxDb`. The
// point of running them here rather than under bun is that the code executes
// inside workerd against a real D1 binding — "the invariants hold on D1" is a
// claim about the runtime that will serve them, not about a proxy to it.
//
// What is left at this seam is the workstream rename, whose whole subject is a
// D1 behaviour: a deferred-FK batch that either lands or is refused as a unit.
// The invariants a Problem still carries — the two terminal doors, one Outcome
// per Problem, Observation archiving — are pinned through the deployed request
// path instead, in apps/cloud/workers-test/api.workerd.ts.

let db: CruxDb;

/** One Workstream with one Problem in it. Returns the Problem's id. */
async function seedProblem(): Promise<number> {
  await db.insert(users).values({ id: "USR-t", slug: "t", name: "T" });
  await db.insert(workstreams).values({ id: "WS-t", slug: "t", title: "T", ownerId: "USR-t" });
  const [p] = await db
    .insert(problems)
    .values({ workstreamId: "WS-t", title: "P", description: "D", createdById: "USR-t" })
    .returning({ id: problems.id });
  return p!.id;
}

beforeEach(async () => {
  await reset();
  await applyD1Schema(env.DB);
  db = createD1Db(env.DB);
});

describe("Workstream rename", () => {
  test("carries every referrer to the new id", async () => {
    const problemId = await seedProblem();
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
    await seedProblem();
    await db
      .insert(workstreams)
      .values({ id: "WS-taken", slug: "taken", title: "Taken", ownerId: "USR-t" });

    await expect(renameWorkstream("t", "taken", {}, db)).rejects.toMatchObject({
      code: "ILLEGAL_TRANSITION",
    });

    const ids = (await db.select().from(workstreams)).map((w) => w.id).sort();
    expect(ids).toEqual(["WS-t", "WS-taken"]);
  });
});
