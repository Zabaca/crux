/**
 * The cap is deployment configuration (ADR-0013), so what a deployment can put
 * in the var — including nothing, and including nonsense — is part of the
 * contract. The refusal itself is pinned through the request path in
 * `apps/cloud/workers-test/capacity.workerd.ts`; only the parse is here.
 */
import { describe, expect, test } from "bun:test";

import { DEFAULT_OBSERVATION_CAP, observationCapFrom } from "../capacity.js";

describe("observationCapFrom", () => {
  test("an unset or blank var means the default allowance", () => {
    expect(observationCapFrom(undefined)).toBe(DEFAULT_OBSERVATION_CAP);
    expect(observationCapFrom("")).toBe(DEFAULT_OBSERVATION_CAP);
    expect(observationCapFrom("   ")).toBe(DEFAULT_OBSERVATION_CAP);
  });

  test("a whole number is the allowance, zero included", () => {
    expect(observationCapFrom("5")).toBe(5);
    expect(observationCapFrom("1000")).toBe(1000);
    // A deployment that wants writes closed can say so.
    expect(observationCapFrom("0")).toBe(0);
  });

  test("a typo falls back rather than taking every write down with it", () => {
    for (const bad of ["two hundred", "20.5", "-1", "1e3x", "NaN"]) {
      expect(observationCapFrom(bad)).toBe(DEFAULT_OBSERVATION_CAP);
    }
  });
});
