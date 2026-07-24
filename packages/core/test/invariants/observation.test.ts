import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import { archiveObservation, NotFoundError, TransitionError } from "../../src/transitions/index.js";
import type { CruxDb } from "../../src/db/client.js";
import { observations } from "../../src/db/schema.js";
import { addObservation, migratedDb, seedBase, TEST_USER } from "../support/fixtures.js";

describe("archiveObservation", () => {
  let db: CruxDb;

  beforeEach(async () => {
    db = await migratedDb();
    await seedBase(db);
  });

  test("archiving keeps the row and records why", async () => {
    await addObservation(db, "OBS-001", "a signal worth keeping");

    await archiveObservation("OBS-001", "duplicate of OBS-000", TEST_USER, db);

    const rows = await db
      .select()
      .from(observations)
      .where(eq(observations.id, "OBS-001"))
      .limit(1);
    // Never deleted — corrected or retired by archiving, so history stays intact.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content).toBe("a signal worth keeping");
    expect(rows[0]!.archiveRationale).toBe("duplicate of OBS-000");
    expect(rows[0]!.archivedById).toBe(TEST_USER);
  });

  test("archiving is terminal — there is no second archive", async () => {
    await addObservation(db, "OBS-002");
    await archiveObservation("OBS-002", "first", TEST_USER, db);

    await expect(archiveObservation("OBS-002", "second", TEST_USER, db)).rejects.toThrow(
      TransitionError,
    );
  });

  test("an Observation that does not exist is not found", async () => {
    await expect(archiveObservation("OBS-404", "nope", TEST_USER, db)).rejects.toThrow(
      NotFoundError,
    );
  });
});
