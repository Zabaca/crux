/**
 * Tests for dispatch() — action validation, allowed-list enforcement, collab mode.
 *
 * These tests do NOT require a database for the allowed-list enforcement tests.
 * DB-backed mutation tests are in cli.test.ts integration layer.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { ActionNotAllowedError } from "../dispatch.js";
import { isActionAllowed } from "../allowed.js";

describe("ActionNotAllowedError", () => {
  test("has correct code and fields", () => {
    const err = new ActionNotAllowedError({ viewing: "workstream_list" }, "ADD_PROBLEM", {
      allowedView: ["SELECT_WORKSTREAM"],
      allowedMutation: ["ADD_WORKSTREAM"],
      globals: ["BACK"],
    });
    expect(err.code).toBe("ACTION_NOT_ALLOWED");
    expect(err.attempted).toBe("ADD_PROBLEM");
    expect(err.allowedMutation).toContain("ADD_WORKSTREAM");
    expect(err instanceof ActionNotAllowedError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});

describe("CRUX_COLLAB flag — allowed list logic", () => {
  const originalCollab = process.env.CRUX_COLLAB;

  beforeEach(() => {
    delete process.env.CRUX_COLLAB;
  });
  afterEach(() => {
    if (originalCollab !== undefined) {
      process.env.CRUX_COLLAB = originalCollab;
    } else {
      delete process.env.CRUX_COLLAB;
    }
  });

  test("ADD_PROBLEM rejected from workstream_list when CRUX_COLLAB=1", () => {
    process.env.CRUX_COLLAB = "1";
    const allowed = isActionAllowed("ADD_PROBLEM", { viewing: "workstream_list" });
    expect(allowed).toBe(false);
  });

  test("ADD_PROBLEM allowed from workstream_dashboard", () => {
    const allowed = isActionAllowed("ADD_PROBLEM", { viewing: "workstream_dashboard" });
    expect(allowed).toBe(true);
  });

  test("BACK is always allowed (global)", () => {
    expect(isActionAllowed("BACK", { viewing: "workstream_list" })).toBe(true);
    expect(isActionAllowed("BACK", { viewing: "problem_detail" })).toBe(true);
  });

  test("ADD_IDEA is always allowed (global)", () => {
    expect(isActionAllowed("ADD_IDEA", { viewing: "workstream_list" })).toBe(true);
    expect(isActionAllowed("ADD_IDEA", { viewing: "intake_queue" })).toBe(true);
  });
});

describe("ActionSchema validation", () => {
  test("valid VIEW action parses", async () => {
    const { ActionSchema } = await import("../schemas.js");
    const result = ActionSchema.safeParse({ kind: "SELECT_WORKSTREAM", payload: { slug: "crux" } });
    expect(result.success).toBe(true);
  });

  test("valid MUTATION action parses", async () => {
    const { ActionSchema } = await import("../schemas.js");
    const result = ActionSchema.safeParse({
      kind: "ADD_PROBLEM",
      payload: { workstream: "crux", slug: "p1", title: "P", description: "d" },
    });
    expect(result.success).toBe(true);
  });

  test("unknown kind fails", async () => {
    const { ActionSchema } = await import("../schemas.js");
    const result = ActionSchema.safeParse({ kind: "BOGUS_ACTION", payload: {} });
    expect(result.success).toBe(false);
  });
});
