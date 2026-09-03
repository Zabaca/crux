/**
 * Tenancy: what a Principal can see of another Principal's corpus, which is
 * nothing (ADR-0013).
 *
 * The table below has one probe per `QueryKind` and is typed as a *total*
 * `Record<QueryKind, …>`, so a read kind added without a probe is a compile
 * error; the assertion in the first test is the runtime half, catching a kind
 * added to `QuerySchema` while this file is compiled against a stale build.
 * "Every read is accounted for" is the property being pinned — an unscoped read
 * is a cross-tenant disclosure, and the way one arrives is by omission.
 *
 * Every probe asks the *same* question with A's ids while authenticated as B,
 * and demands one of two answers: nothing, or `NOT_FOUND`. Never A's rows, and
 * never a distinguishable "forbidden" — an error that separated "not yours"
 * from "not there" would turn any read into an oracle.
 */
import { env, reset } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";

import { createD1Db, type CruxDb } from "../src/db/client.js";
import { applyD1Schema } from "../src/db/d1/index.js";
import { query, QuerySchema, type QueryKind } from "../src/reads/index.js";
import { NotFoundError } from "../src/transitions/errors.js";
import {
  abandonments,
  attempts,
  evidence,
  observations,
  outcomes,
  problems,
  users,
  workstreams,
} from "../src/db/schema.js";

let db: CruxDb;

/** Everything one Principal filed, and the ids a probe needs to ask about. */
type Corpus = {
  principal: { id: string };
  workstreamId: string;
  slug: string;
  problemId: number;
  /** Both Problems — the live one and the abandoned one. */
  problemIds: number[];
  observationId: string;
  evidenceId: string;
  attemptId: string;
  abandonmentId: string;
  outcomeId: string;
};

/**
 * File a complete corpus — one of every entity — under a fresh Principal.
 *
 * Two Problems, because a Problem cannot be both abandoned and have an Outcome:
 * the terminal doors are exclusive, and a probe for each needs one of each.
 */
async function seedCorpus(tag: string): Promise<Corpus> {
  const principalId = `USR-${tag}`;
  const workstreamId = `WS-${tag}`;
  await db.insert(users).values({ id: principalId, slug: tag, name: tag });
  await db
    .insert(workstreams)
    .values({ id: workstreamId, slug: tag, title: `${tag} title`, ownerId: principalId });
  await db.insert(observations).values({
    id: `OBS-${tag}`,
    workstreamId,
    reporterId: principalId,
    content: `${tag} secret content`,
  });
  const [problem] = await db
    .insert(problems)
    .values({
      workstreamId,
      title: `${tag} secret problem`,
      description: `${tag} secret description`,
      status: "now",
      createdById: principalId,
    })
    .returning({ id: problems.id });
  const [abandoned] = await db
    .insert(problems)
    .values({
      workstreamId,
      title: `${tag} abandoned`,
      description: "d",
      status: "abandoned",
      createdById: principalId,
    })
    .returning({ id: problems.id });
  await db.insert(evidence).values({
    id: `EVD-${tag}`,
    observationId: `OBS-${tag}`,
    problemId: problem!.id,
    note: "why",
    createdById: principalId,
  });
  await db.insert(attempts).values({
    id: `ATT-${tag}`,
    problemId: problem!.id,
    ref: `https://tracker.example/${tag}`,
    label: `${tag} attempt`,
    createdById: principalId,
  });
  await db.insert(abandonments).values({
    id: `ABN-${tag}`,
    problemId: abandoned!.id,
    rationale: `${tag} gave up`,
    abandonedById: principalId,
  });
  await db.insert(outcomes).values({
    id: `OUT-${tag}`,
    problemId: problem!.id,
    observedImpact: `${tag} impact`,
    recordedById: principalId,
  });
  return {
    principal: { id: principalId },
    workstreamId,
    slug: tag,
    problemId: problem!.id,
    problemIds: [problem!.id, abandoned!.id],
    observationId: `OBS-${tag}`,
    evidenceId: `EVD-${tag}`,
    attemptId: `ATT-${tag}`,
    abandonmentId: `ABN-${tag}`,
    outcomeId: `OUT-${tag}`,
  };
}

/** The read a probe issues, phrased entirely in terms of A's ids. */
type Probe = (a: Corpus) => Record<string, unknown>;

const PROBES: Record<QueryKind, Probe> = {
  WORKSTREAM_LIST: () => ({ kind: "WORKSTREAM_LIST" }),
  WORKSTREAM_SHOW: (a) => ({ kind: "WORKSTREAM_SHOW", id: a.workstreamId }),
  WORKSTREAM_GET: (a) => ({ kind: "WORKSTREAM_GET", id: a.workstreamId }),
  WORKSTREAM_BY_SLUG: (a) => ({ kind: "WORKSTREAM_BY_SLUG", slug: a.slug }),
  WORKSTREAM_SUMMARIES: () => ({ kind: "WORKSTREAM_SUMMARIES" }),

  OBSERVATION_LIST: (a) => ({ kind: "OBSERVATION_LIST", workstream: a.slug }),
  OBSERVATION_SHOW: (a) => ({ kind: "OBSERVATION_SHOW", id: a.observationId }),
  OBSERVATION_DETAIL: (a) => ({ kind: "OBSERVATION_DETAIL", id: a.observationId }),
  OBSERVATION_UNLINKED: (a) => ({ kind: "OBSERVATION_UNLINKED", workstreamId: a.workstreamId }),
  OBSERVATION_SUMMARIES: (a) => ({ kind: "OBSERVATION_SUMMARIES", workstreamId: a.workstreamId }),

  PROBLEM_LIST: (a) => ({ kind: "PROBLEM_LIST", workstream: a.slug }),
  PROBLEM_SHOW: (a) => ({ kind: "PROBLEM_SHOW", id: a.problemId }),
  PROBLEM_GET: (a) => ({ kind: "PROBLEM_GET", id: a.problemId }),
  PROBLEM_SUMMARIES: (a) => ({ kind: "PROBLEM_SUMMARIES", workstreamId: a.workstreamId }),
  PROBLEM_DETAIL: (a) => ({ kind: "PROBLEM_DETAIL", id: a.problemId }),
  PROBLEM_DRIFT: (a) => ({ kind: "PROBLEM_DRIFT", workstream: a.slug }),

  EVIDENCE_LIST: () => ({ kind: "EVIDENCE_LIST" }),
  ATTEMPT_LIST: () => ({ kind: "ATTEMPT_LIST" }),

  ABANDONMENT_LIST: (a) => ({ kind: "ABANDONMENT_LIST", workstream: a.slug }),
  ABANDONMENT_SHOW: (a) => ({ kind: "ABANDONMENT_SHOW", id: a.abandonmentId }),

  OUTCOME_LIST: () => ({ kind: "OUTCOME_LIST" }),
  OUTCOME_SHOW: (a) => ({ kind: "OUTCOME_SHOW", id: a.outcomeId }),

  SEARCH: () => ({ kind: "SEARCH", q: "secret" }),
};

/**
 * Any of `ids` appearing as an `id` or `problemId` anywhere inside `value`.
 *
 * A read nests rows several levels down — a Problem carries its Evidence,
 * which carries its Observation — so a leak is not necessarily at the top
 * level, and a substring search over the JSON cannot tell an integer id from
 * the same digits inside an epoch timestamp.
 */
function foreignProblemIds(value: unknown, ids: number[]): number[] {
  const wanted = new Set(ids);
  const found = new Set<number>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if ((key === "id" || key === "problemId") && typeof child === "number" && wanted.has(child)) {
        found.add(child);
      }
      walk(child);
    }
  };
  walk(value);
  return [...found];
}

/** Every kind the read schema actually serves, read off the schema itself. */
function declaredKinds(): QueryKind[] {
  return QuerySchema.options.map((option) => {
    const literal = (option.shape as { kind: { value: QueryKind } }).kind;
    return literal.value;
  });
}

beforeEach(async () => {
  await reset();
  db = createD1Db(env.DB);
  await applyD1Schema(env.DB);
});

describe("every read is scoped to its Principal", () => {
  test("every declared read kind has a cross-tenant probe", () => {
    expect([...declaredKinds()].sort()).toEqual(Object.keys(PROBES).sort());
  });

  for (const kind of Object.keys(PROBES) as QueryKind[]) {
    test(`${kind} shows B nothing of A's`, async () => {
      const a = await seedCorpus("alpha");
      const b = await seedCorpus("bravo");

      // A can see its own corpus through this read: without this half, a probe
      // would also pass against a read that is simply broken for everyone.
      const mine = await query(PROBES[kind](a), { db, principal: a.principal });
      expect(mine).not.toBeNull();

      let theirs: unknown;
      try {
        theirs = await query(PROBES[kind](a), { db, principal: b.principal });
      } catch (err) {
        // Missing, in the same words as a row that never existed.
        expect(err).toBeInstanceOf(NotFoundError);
        return;
      }

      // Nothing of A's. Several of these reads legitimately answer with B's own
      // rows, so the assertion is about *whose* rows came back, not how many.
      // Every string A owns carries its tag; A's Problems are integers and are
      // hunted structurally, since "3" appears inside any timestamp.
      expect(JSON.stringify(theirs ?? null)).not.toContain("alpha");
      expect(foreignProblemIds(theirs, a.problemIds)).toEqual([]);
    });
  }

  test("B's own corpus still reads back in full", async () => {
    await seedCorpus("alpha");
    const b = await seedCorpus("bravo");
    const list = (await query(
      { kind: "WORKSTREAM_LIST" },
      { db, principal: b.principal },
    )) as Array<{
      id: string;
    }>;
    expect(list.map((w) => w.id)).toEqual([b.workstreamId]);
  });

  test("a Principal that owns nothing sees an empty corpus, not everyone's", async () => {
    await seedCorpus("alpha");
    await db.insert(users).values({ id: "USR-new", slug: "new", name: "new" });
    const list = await query({ kind: "WORKSTREAM_LIST" }, { db, principal: { id: "USR-new" } });
    expect(list).toEqual([]);
    const search = (await query(
      { kind: "SEARCH", q: "secret" },
      { db, principal: { id: "USR-new" } },
    )) as { problems: unknown[]; observations: unknown[] };
    expect(search.problems).toEqual([]);
    expect(search.observations).toEqual([]);
  });

  test("a token naming a row that no longer exists scopes to nothing", async () => {
    await seedCorpus("alpha");
    const list = await query({ kind: "WORKSTREAM_LIST" }, { db, principal: { id: "USR-ghost" } });
    expect(list).toEqual([]);
  });
});
