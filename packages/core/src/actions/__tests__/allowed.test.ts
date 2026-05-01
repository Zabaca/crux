import { describe, test, expect } from "bun:test";
import { getAllowedActions, isActionAllowed, leafStateName } from "../allowed.js";

describe("leafStateName", () => {
  test("string value returns itself", () => {
    expect(leafStateName("workstream_list")).toBe("workstream_list");
  });
  test("nested value returns leaf", () => {
    expect(leafStateName({ viewing: "workstream_list" })).toBe("workstream_list");
    expect(leafStateName({ viewing: "problem_detail" })).toBe("problem_detail");
  });
});

describe("getAllowedActions", () => {
  test("workstream_list allows SELECT_WORKSTREAM + ADD_WORKSTREAM", () => {
    const a = getAllowedActions({ viewing: "workstream_list" });
    expect(a.allowedView).toContain("SELECT_WORKSTREAM");
    expect(a.allowedMutation).toContain("ADD_WORKSTREAM");
    expect(a.globals).toContain("BACK");
  });

  test("problem_detail allows ADD_SOLUTION and ABANDON_PROBLEM", () => {
    const a = getAllowedActions({ viewing: "problem_detail" });
    expect(a.allowedMutation).toContain("ADD_SOLUTION");
    expect(a.allowedMutation).toContain("ABANDON_PROBLEM");
    expect(a.allowedView).toContain("BACK");
  });

  test("workstream_dashboard allows OPEN_PROBLEM", () => {
    const a = getAllowedActions({ viewing: "workstream_dashboard" });
    expect(a.allowedView).toContain("OPEN_PROBLEM");
    expect(a.allowedMutation).toContain("ADD_PROBLEM");
  });
});

describe("isActionAllowed", () => {
  test("ADD_OBSERVATION is allowed everywhere (global)", () => {
    expect(isActionAllowed("ADD_OBSERVATION", { viewing: "workstream_list" })).toBe(true);
    expect(isActionAllowed("ADD_OBSERVATION", { viewing: "problem_detail" })).toBe(true);
    expect(isActionAllowed("ADD_OBSERVATION", { viewing: "intake_queue" })).toBe(true);
  });

  test("ADD_PROBLEM not allowed from workstream_list", () => {
    expect(isActionAllowed("ADD_PROBLEM", { viewing: "workstream_list" })).toBe(false);
  });

  test("ADD_PROBLEM allowed from workstream_dashboard", () => {
    expect(isActionAllowed("ADD_PROBLEM", { viewing: "workstream_dashboard" })).toBe(true);
  });

  test("ADD_SOLUTION not allowed from workstream_dashboard", () => {
    expect(isActionAllowed("ADD_SOLUTION", { viewing: "workstream_dashboard" })).toBe(false);
  });

  test("ADD_SOLUTION allowed from problem_detail", () => {
    expect(isActionAllowed("ADD_SOLUTION", { viewing: "problem_detail" })).toBe(true);
  });
});
