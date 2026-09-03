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
// What is left at this seam is the workstream rename, whose subject is what a
// rename does to the rows hanging off a Workstream: nothing, now that the id is
// opaque rather than `WS-<slug>`. Whether a new slug is free is a question
// about the caller's scope, so it lives in `actions/mutations.ts` and is pinned
// through the deployed request path — as are the invariants a Problem carries,
// in apps/cloud/workers-test/api.workerd.ts.

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
  test("changes the slug and moves no referrer, because the id does not change", async () => {
    const problemId = await seedProblem();
    await db.insert(observations).values({
      id: "OBS-001",
      workstreamId: "WS-t",
      reporterId: "USR-t",
      content: "a signal",
    });

    const result = await renameWorkstream("WS-t", "renamed", { title: "Renamed" }, db);

    expect(result).toMatchObject({ id: "WS-t", oldSlug: "t", newSlug: "renamed" });
    const [ws] = await db.select().from(workstreams);
    expect(ws).toMatchObject({ id: "WS-t", slug: "renamed", title: "Renamed" });
    const [obs] = await db.select().from(observations);
    expect(obs!.workstreamId).toBe("WS-t");
    const [prob] = await db.select().from(problems);
    expect(prob!.workstreamId).toBe("WS-t");
    expect(prob!.id).toBe(problemId);
  });

  test("refuses a slug the same owner already holds, changing nothing", async () => {
    // The check that reports this lives in `runMutation`, which knows the
    // caller's scope; the index is the backstop that makes it an invariant
    // rather than a race.
    await seedProblem();
    await db
      .insert(workstreams)
      .values({ id: "WS-taken", slug: "taken", title: "Taken", ownerId: "USR-t" });

    await expect(renameWorkstream("WS-t", "taken", {}, db)).rejects.toThrow();

    const slugs = (await db.select().from(workstreams)).map((w) => w.slug).sort();
    expect(slugs).toEqual(["t", "taken"]);
  });

  test("allows a slug another owner holds", async () => {
    await seedProblem();
    await db.insert(users).values({ id: "USR-other", slug: "other", name: "Other" });
    await db
      .insert(workstreams)
      .values({ id: "WS-theirs", slug: "theirs", title: "Theirs", ownerId: "USR-other" });

    await renameWorkstream("WS-t", "theirs", {}, db);

    const rows = await db.select().from(workstreams);
    expect(
      rows
        .filter((w) => w.slug === "theirs")
        .map((w) => w.ownerId)
        .sort(),
    ).toEqual(["USR-other", "USR-t"]);
  });
});
