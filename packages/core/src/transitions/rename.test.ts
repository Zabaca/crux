import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  decisions,
  evidence,
  observations,
  problems,
  solutions,
  users,
  workstreams,
} from "../db/schema.js";
import { createTestDb, type CruxTestDb } from "../db/test-utils.js";
import { NotFoundError, TransitionError } from "./errors.js";
import { renameProblem } from "./rename.js";

let db: CruxTestDb;
let cleanup: () => void;

beforeEach(async () => {
  ({ db, cleanup } = await createTestDb());

  // Seed: 1 user, 1 workstream, 1 problem with 2 solutions, 2 observations,
  // 2 evidence rows, 1 decision.
  await db.insert(users).values({ id: "USR-x", slug: "x", name: "x" });
  await db.insert(workstreams).values({
    id: "WS-acme",
    slug: "acme",
    title: "Acme",
  });
  await db.insert(problems).values({
    id: "PRB-foo",
    slug: "foo",
    workstreamId: "WS-acme",
    title: "Foo",
    description: "d",
    createdById: "USR-x",
  });
  await db.insert(solutions).values([
    {
      id: "SOL-a",
      slug: "a",
      problemId: "PRB-foo",
      title: "A",
      createdById: "USR-x",
    },
    {
      id: "SOL-b",
      slug: "b",
      problemId: "PRB-foo",
      title: "B",
      createdById: "USR-x",
    },
  ]);
  await db.insert(observations).values([
    {
      id: "OBS-001",
      workstreamId: "WS-acme",
      reporterId: "USR-x",
      content: "first",
    },
    {
      id: "OBS-002",
      workstreamId: "WS-acme",
      reporterId: "USR-x",
      content: "second",
    },
  ]);
  await db.insert(evidence).values([
    {
      id: "EVD-001",
      observationId: "OBS-001",
      problemId: "PRB-foo",
      createdById: "USR-x",
    },
    {
      id: "EVD-002",
      observationId: "OBS-002",
      problemId: "PRB-foo",
      createdById: "USR-x",
    },
  ]);
  await db.insert(decisions).values({
    id: "DEC-001",
    problemId: "PRB-foo",
    chosenSolutionId: "SOL-a",
    rationale: "r",
    decidedById: "USR-x",
  });
});

afterEach(() => {
  cleanup();
});

describe("renameProblem", () => {
  test("renames problem and cascades to all FK referrers", async () => {
    const r = await renameProblem("foo", "bar", { title: "Bar Problem", description: "new" }, db);
    expect(r.oldId).toBe("PRB-foo");
    expect(r.newId).toBe("PRB-bar");

    // The problem row was renamed and updated.
    const old = await db.select().from(problems).where(eq(problems.id, "PRB-foo"));
    expect(old.length).toBe(0);
    const cur = await db.select().from(problems).where(eq(problems.id, "PRB-bar"));
    expect(cur.length).toBe(1);
    expect(cur[0].slug).toBe("bar");
    expect(cur[0].title).toBe("Bar Problem");
    expect(cur[0].description).toBe("new");
    // Solutions cascade.
    const sols = await db.select().from(solutions).where(eq(solutions.problemId, "PRB-bar"));
    expect(sols.length).toBe(2);

    // Evidence cascade.
    const ev = await db.select().from(evidence).where(eq(evidence.problemId, "PRB-bar"));
    expect(ev.length).toBe(2);

    // Decision cascade.
    const dec = await db.select().from(decisions).where(eq(decisions.problemId, "PRB-bar"));
    expect(dec.length).toBe(1);
  });

  test("FK integrity holds after rename", async () => {
    await renameProblem("foo", "bar", {}, db);
    // @ts-expect-error raw client exec
    const fkCheck = await db.session.client.execute("PRAGMA foreign_key_check");
    expect(fkCheck.rows.length).toBe(0);
  });

  test("rename to existing slug throws TransitionError", async () => {
    await db.insert(problems).values({
      id: "PRB-other",
      slug: "other",
      workstreamId: "WS-acme",
      title: "Other",
      description: "d",
      createdById: "USR-x",
    });
    expect(renameProblem("foo", "other", {}, db)).rejects.toBeInstanceOf(TransitionError);
  });

  test("rename of nonexistent slug throws NotFoundError", async () => {
    expect(renameProblem("nope", "bar", {}, db)).rejects.toBeInstanceOf(NotFoundError);
  });

  test("rename to same slug with metadata-only update succeeds", async () => {
    await renameProblem("foo", "foo", { title: "Renamed" }, db);
    const cur = await db.select().from(problems).where(eq(problems.id, "PRB-foo"));
    expect(cur[0].title).toBe("Renamed");
    expect(cur[0].slug).toBe("foo");
  });
});
