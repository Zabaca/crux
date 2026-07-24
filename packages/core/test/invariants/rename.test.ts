import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import { NotFoundError, renameWorkstream, TransitionError } from "../../src/transitions/index.js";
import type { CruxDb } from "../../src/db/client.js";
import { observations, problems, workstreams } from "../../src/db/schema.js";
import {
  addObservation,
  addProblem,
  migratedDb,
  seedBase,
  TEST_USER,
} from "../support/fixtures.js";

describe("renameWorkstream", () => {
  let db: CruxDb;

  beforeEach(async () => {
    db = await migratedDb();
    await seedBase(db);
  });

  test("renaming carries every referrer to the new id", async () => {
    const problemId = await addProblem(db);
    await addObservation(db, "OBS-100");

    const result = await renameWorkstream("test", "renamed", {}, db);

    expect(result).toMatchObject({ oldId: "WS-test", newId: "WS-renamed", newSlug: "renamed" });
    const [problem] = await db
      .select({ workstreamId: problems.workstreamId })
      .from(problems)
      .where(eq(problems.id, problemId));
    expect(problem!.workstreamId).toBe("WS-renamed");
    const [observation] = await db
      .select({ workstreamId: observations.workstreamId })
      .from(observations)
      .where(eq(observations.id, "OBS-100"));
    expect(observation!.workstreamId).toBe("WS-renamed");
    const stale = await db.select().from(workstreams).where(eq(workstreams.id, "WS-test"));
    expect(stale).toHaveLength(0);
  });

  test("metadata can be edited without changing the slug", async () => {
    await renameWorkstream("test", "test", { title: "Renamed title" }, db);

    const [row] = await db.select().from(workstreams).where(eq(workstreams.slug, "test"));
    expect(row!.title).toBe("Renamed title");
    expect(row!.id).toBe("WS-test");
  });

  test("a taken slug is refused", async () => {
    await db.insert(workstreams).values({ id: "WS-other", slug: "other", title: "Other" });

    await expect(renameWorkstream("test", "other", {}, db)).rejects.toThrow(TransitionError);

    const [row] = await db.select().from(workstreams).where(eq(workstreams.slug, "test"));
    expect(row!.id).toBe("WS-test");
  });

  test("renaming a workstream that does not exist is not found", async () => {
    await expect(renameWorkstream("ghost", "spectre", {}, db)).rejects.toThrow(NotFoundError);
  });

  test("the rename leaves no orphaned rows behind", async () => {
    await addProblem(db);
    await renameWorkstream("test", "renamed", {}, db);

    // Every problem must still point at a workstream that exists — the whole
    // reason the rename has to move referrers in lockstep with the PK.
    const orphans = await db
      .select({ id: problems.id })
      .from(problems)
      .leftJoin(workstreams, eq(problems.workstreamId, workstreams.id))
      .where(eq(problems.createdById, TEST_USER));
    expect(orphans).toHaveLength(1);
    const [ws] = await db.select().from(workstreams).where(eq(workstreams.id, "WS-renamed"));
    expect(ws).toBeDefined();
  });
});
