import { describe, expect, test } from "vitest";
import {
  DecisionInput,
  EliminationInput,
  ObservationInput,
  ProblemInput,
  RoadmapStage,
  WorkstreamInput,
} from "../../src/validation/schemas.js";

describe("WorkstreamInput", () => {
  test("accepts a kebab-case slug", () => {
    expect(WorkstreamInput.safeParse({ slug: "cloud-crux", title: "Cloud crux" }).success).toBe(
      true,
    );
  });

  test("rejects a slug that is not kebab-case lowercase", () => {
    for (const slug of ["Cloud Crux", "cloud_crux", "-leading", ""]) {
      expect(WorkstreamInput.safeParse({ slug, title: "t" }).success).toBe(false);
    }
  });

  test("requires a title", () => {
    expect(WorkstreamInput.safeParse({ slug: "crux", title: "" }).success).toBe(false);
  });
});

describe("ObservationInput", () => {
  test("sourceType is limited to the documented vocabulary", () => {
    const base = { workstream: "crux", content: "a signal" };
    expect(ObservationInput.safeParse({ ...base, sourceType: "customer_report" }).success).toBe(
      true,
    );
    expect(ObservationInput.safeParse({ ...base, sourceType: "hearsay" }).success).toBe(false);
  });

  test("content is required — an empty Observation is not intake", () => {
    expect(ObservationInput.safeParse({ workstream: "crux", content: "" }).success).toBe(false);
  });
});

describe("ProblemInput", () => {
  test("a Problem needs both a title and a description", () => {
    expect(
      ProblemInput.safeParse({ workstream: "crux", title: "T", description: "D" }).success,
    ).toBe(true);
    expect(ProblemInput.safeParse({ workstream: "crux", title: "T" }).success).toBe(false);
  });
});

describe("RoadmapStage", () => {
  test("the roadmap has exactly now, next and later", () => {
    expect(RoadmapStage.options).toEqual(["now", "next", "later"]);
    expect(RoadmapStage.safeParse("done").success).toBe(false);
  });
});

describe("DecisionInput", () => {
  test("rejected defaults to an empty list", () => {
    const parsed = DecisionInput.parse({
      workstream: "crux",
      problemId: 1,
      chosen: 2,
      rationale: "because",
    });
    expect(parsed.rejected).toEqual([]);
  });

  test("a Decision needs a rationale", () => {
    expect(
      DecisionInput.safeParse({ workstream: "crux", problemId: 1, chosen: 2, rationale: "" })
        .success,
    ).toBe(false);
  });
});

describe("EliminationInput", () => {
  test("an Elimination must name at least one Solution", () => {
    expect(
      EliminationInput.safeParse({ problemId: 1, solutions: [2, 3], rationale: "too slow" })
        .success,
    ).toBe(true);
    expect(
      EliminationInput.safeParse({ problemId: 1, solutions: [], rationale: "too slow" }).success,
    ).toBe(false);
  });
});
