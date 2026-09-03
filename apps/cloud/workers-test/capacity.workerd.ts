/**
 * The free allowance on an unclaimed Principal (ADR-0013), pinned through the
 * deployed request path.
 *
 * `SELF.fetch` is the seam on purpose: the cap is not a property of a transition
 * function, it is a property of what the deployment answers — the status, the
 * stable code, and the claim URL an agent reads out of `details` in the
 * conversation where the wall was hit. None of that exists below HTTP.
 *
 * The cap here comes from the `CRUX_OBSERVATION_CAP` binding `vitest.config.ts`
 * sets, and is read back off `env` rather than written down twice. The default
 * is two hundred and appears nowhere in this file: if these tests pass, the
 * allowance is configuration rather than a constant — and raising the binding
 * does not falsify them.
 */
import { env, SELF, reset } from "cloudflare:test";
import { beforeEach, expect, test, describe } from "vitest";
import { eq } from "drizzle-orm";

import { createD1Db, type CruxDb } from "@crux/core/db";
import { applyD1Schema } from "@crux/core/db/d1";
import { users } from "@crux/core/db/schema";

/** The allowance this suite runs against, from the binding itself. */
const CAP = Number(env.CRUX_OBSERVATION_CAP);

let db: CruxDb;

function as(bearer: string, path: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`https://crux.example${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}
const dispatchAs = (bearer: string, action: unknown) =>
  as(bearer, "/v1/dispatch", { method: "POST", body: JSON.stringify(action) });
const queryAs = (bearer: string, q: unknown) =>
  as(bearer, "/v1/query", { method: "POST", body: JSON.stringify(q) });

/** A Principal minted the way a machine with no configuration does, with a
 * Workstream of its own to file into. */
async function principalWithWorkstream(slug: string) {
  const res = await SELF.fetch("https://crux.example/v1/principals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const { token, principal } = (await res.json()) as {
    token: string;
    principal: { id: string };
  };
  await dispatchAs(token, { kind: "ADD_WORKSTREAM", payload: { slug, title: slug } });
  return { token, id: principal.id, slug };
}

/** File `n` Observations, asserting each one is accepted. */
async function fileObservations(token: string, slug: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    const res = await dispatchAs(token, {
      kind: "ADD_OBSERVATION",
      payload: { workstream: slug, content: `signal ${i}` },
    });
    expect(res.status).toBe(200);
  }
}

type Refusal = {
  error: { code: string; message: string; details: Record<string, unknown> };
};

beforeEach(async () => {
  await reset();
  db = createD1Db(env.DB);
  await applyD1Schema(env.DB);
});

describe("an unclaimed Principal at its cap", () => {
  test("refuses a further Observation with CAPACITY_EXCEEDED and the claim link", async () => {
    const p = await principalWithWorkstream("capped");
    await fileObservations(p.token, p.slug, CAP);

    const refused = await dispatchAs(p.token, {
      kind: "ADD_OBSERVATION",
      payload: { workstream: p.slug, content: "one too many" },
    });
    expect(refused.status).toBe(429);
    const body = (await refused.json()) as Refusal;
    expect(body.error.code).toBe("CAPACITY_EXCEEDED");
    expect(body.error.details).toMatchObject({
      cap: CAP,
      observations: CAP,
      claimUrl: "https://crux.example/claim",
      principalId: p.id,
    });
    // The fix is in the prose too, so an agent that only surfaces the message
    // still says what to do about it.
    expect(body.error.message).toContain("https://crux.example/claim");
  });

  test("reads keep working across every surface the corpus is read from", async () => {
    const p = await principalWithWorkstream("readable");
    await dispatchAs(p.token, {
      kind: "ADD_PROBLEM",
      payload: { workstream: p.slug, title: "still visible", description: "d" },
    });
    await fileObservations(p.token, p.slug, CAP);

    const list = await queryAs(p.token, { kind: "WORKSTREAM_LIST" });
    expect(list.status).toBe(200);
    expect(((await list.json()) as { result: unknown[] }).result).toHaveLength(1);

    const observations = await queryAs(p.token, {
      kind: "OBSERVATION_LIST",
      workstream: p.slug,
    });
    expect(observations.status).toBe(200);
    expect(((await observations.json()) as { result: unknown[] }).result).toHaveLength(CAP);

    const problems = await queryAs(p.token, {
      kind: "PROBLEM_LIST",
      workstream: p.slug,
      status: "unscheduled",
    });
    expect(problems.status).toBe(200);
    const listed = (await problems.json()) as { result: Array<{ title: string }> };
    expect(listed.result.map((x) => x.title)).toEqual(["still visible"]);
  });

  test("refuses every write, not only the metered one", async () => {
    const p = await principalWithWorkstream("locked");
    const problem = (await (
      await dispatchAs(p.token, {
        kind: "ADD_PROBLEM",
        payload: { workstream: p.slug, title: "before the wall", description: "d" },
      })
    ).json()) as { result: { id: number } };
    await fileObservations(p.token, p.slug, CAP);

    // The meter is Observations; the lockout is writes (ADR-0013).
    for (const action of [
      { kind: "ADD_PROBLEM", payload: { workstream: p.slug, title: "t", description: "d" } },
      { kind: "SCHEDULE_PROBLEM", payload: { id: problem.result.id, stage: "now" } },
      { kind: "ADD_WORKSTREAM", payload: { slug: "another", title: "another" } },
    ]) {
      const res = await dispatchAs(p.token, action);
      expect(res.status).toBe(429);
      expect((await res.json()) as Refusal).toMatchObject({
        error: { code: "CAPACITY_EXCEEDED" },
      });
    }
  });

  // Note: workerd logs a `Cannot convert undefined or null to object` from
  // xstate while this runs. It is a mutation-then-view-action sequence on a view
  // blob that has meta but no snapshot yet, it predates this change and it does
  // not affect the response — the dispatch below answers 200 either way.
  test("still navigates: a view action is reading, not writing", async () => {
    const p = await principalWithWorkstream("browsing");
    await fileObservations(p.token, p.slug, CAP);

    const res = await dispatchAs(p.token, {
      kind: "SELECT_WORKSTREAM",
      payload: { id: `WS-${p.slug}` },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { viewState: unknown }).viewState).toEqual({
      viewing: "workstream_dashboard",
    });
  });
});

describe("the cap's edges", () => {
  test("the last Observation inside the allowance is accepted", async () => {
    const p = await principalWithWorkstream("edge");
    await fileObservations(p.token, p.slug, CAP - 1);
    const last = await dispatchAs(p.token, {
      kind: "ADD_OBSERVATION",
      payload: { workstream: p.slug, content: "the last one" },
    });
    expect(last.status).toBe(200);
  });

  test("a claimed Principal is uncapped", async () => {
    const p = await principalWithWorkstream("claimed");
    await fileObservations(p.token, p.slug, CAP);
    // Claiming is what attaches an email; its presence is the whole test, so
    // the row is stamped directly here rather than walked through the mail —
    // `claims.workerd.ts` covers the walk.
    await db.update(users).set({ email: "dana@example.com" }).where(eq(users.id, p.id));

    const res = await dispatchAs(p.token, {
      kind: "ADD_OBSERVATION",
      payload: { workstream: p.slug, content: "past the wall" },
    });
    expect(res.status).toBe(200);
  });

  test("one Principal's spent allowance does not touch another's", async () => {
    const spent = await principalWithWorkstream("spent");
    await fileObservations(spent.token, spent.slug, CAP);
    const fresh = await principalWithWorkstream("fresh");
    const res = await dispatchAs(fresh.token, {
      kind: "ADD_OBSERVATION",
      payload: { workstream: fresh.slug, content: "mine, not theirs" },
    });
    expect(res.status).toBe(200);
  });
});
