/**
 * Integration tests for CLI commands via direct module import.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

import { setDb } from "@crux/core/db";
import { createTestDb, type CruxTestDb } from "@crux/core/db/test-utils";
import { users } from "@crux/core/db/schema";
import { setCaptureWriter, setJsonMode, emit } from "../output.js";
import { OkWithIdOutput, ProblemShowOutput, ContextOutput } from "@crux/core/validation";
import { ActionNotAllowedError } from "@crux/core/actions";

import { workstreamCommand } from "../commands/workstream.js";
import { problemCommand } from "../commands/problem.js";
import { observationCommand } from "../commands/observation.js";
import { evidenceCommand } from "../commands/evidence.js";
import { contextCommand } from "../commands/context.js";
import { solutionCommand } from "../commands/solution.js";

type AnyCmd = {
  run?: (ctx: { args: Record<string, unknown>; rawArgs?: string[] }) => Promise<void>;
  subCommands?: Record<string, AnyCmd>;
};

async function runCmd(parent: AnyCmd, sub: string, args: Record<string, unknown>): Promise<void> {
  let cmd: AnyCmd;
  if (sub === "run") {
    cmd = parent;
  } else {
    cmd = parent.subCommands![sub]!;
  }
  await cmd.run!({ args, rawArgs: [] });
}

async function capture<T>(fn: () => Promise<void>): Promise<T> {
  let result: unknown;
  setCaptureWriter((payload) => {
    result = payload;
  });
  try {
    await fn();
  } finally {
    setCaptureWriter(null);
  }
  return result as T;
}

const TEST_USER = { id: "USR-test", slug: "test", name: "Test User", email: "test@example.com" };

let db: CruxTestDb;
let testCleanup: () => void;
let xdgDir: string;

beforeEach(async () => {
  ({ db, cleanup: testCleanup } = await createTestDb());
  setDb(db as unknown as Parameters<typeof setDb>[0]);
  await db.insert(users).values(TEST_USER);

  xdgDir = mkdtempSync(join(tmpdir(), "crux-xdg-"));
  const cfgDir = join(xdgDir, "crux");
  mkdirSync(cfgDir, { recursive: true });
  writeFileSync(
    join(cfgDir, "config.toml"),
    `[user]\nid = "${TEST_USER.id}"\nslug = "${TEST_USER.slug}"\nname = "${TEST_USER.name}"\nemail = "${TEST_USER.email}"\n`,
  );
  process.env.XDG_CONFIG_HOME = xdgDir;

  setJsonMode(false);
  setCaptureWriter(null);
});

afterEach(() => {
  setDb(null);
  testCleanup();
  rmSync(xdgDir, { recursive: true, force: true });
  delete process.env.XDG_CONFIG_HOME;
  setJsonMode(false);
  setCaptureWriter(null);
});

// ---------------------------------------------------------------------------
// Smoke: full round-trip
// ---------------------------------------------------------------------------

describe("smoke: workstream → problem → observation → evidence link → context", () => {
  test("creates entities and context returns them all", async () => {
    // workstream add
    const wsResult = await capture<{ ok: boolean; id: string }>(() =>
      runCmd(workstreamCommand as AnyCmd, "add", {
        slug: "smoke",
        title: "Smoke WS",
        json: false,
      }),
    );
    expect(wsResult.ok).toBe(true);
    expect(wsResult.id).toBe("WS-smoke");

    // problem add — no slug, returns integer id
    const pResult = await capture<{ ok: boolean; id: number }>(() =>
      runCmd(problemCommand as AnyCmd, "add", {
        workstream: "WS-smoke",
        title: "First Problem",
        description: "A problem",
        json: false,
      }),
    );
    expect(pResult.ok).toBe(true);
    expect(typeof pResult.id).toBe("number");
    const problemId = pResult.id;

    // observation add
    const obsResult = await capture<{ ok: boolean; id: string }>(() =>
      runCmd(observationCommand as AnyCmd, "add", {
        workstream: "smoke",
        content: "Something observed",
        json: false,
      }),
    );
    expect(obsResult.ok).toBe(true);
    expect(obsResult.id).toMatch(/^OBS-/);
    const obsId = obsResult.id;

    // evidence link (problem is integer id)
    const evResult = await capture<{ ok: boolean; id: string }>(() =>
      runCmd(evidenceCommand as AnyCmd, "link", {
        observation: obsId,
        problem: String(problemId),
        json: false,
      }),
    );
    expect(evResult.ok).toBe(true);
    expect(evResult.id).toMatch(/^EVD-/);

    // context
    const ctx = await capture<{
      workstream: { slug: string };
      unscheduled: Array<Record<string, unknown>>;
      now: Array<Record<string, unknown>>;
    }>(() =>
      runCmd(contextCommand as AnyCmd, "run", {
        workstream: "WS-smoke",
        tier: "unscheduled",
        json: false,
      }),
    );
    expect(ctx.workstream.slug).toBe("smoke");
    expect(ctx.unscheduled.length).toBe(1);
    expect(ctx.unscheduled[0]!.id).toBe(problemId);
    expect(ctx.unscheduled[0]!.title).toBe("First Problem");
  });
});

// ---------------------------------------------------------------------------
// Regression OBS-030 (a): context entries have id/title/status at top level
// ---------------------------------------------------------------------------

describe("regression OBS-030 (a): context problem entries spread id/title/status", () => {
  test("unscheduled problem entry has non-null id and title at top level", async () => {
    await runCmd(workstreamCommand as AnyCmd, "add", {
      slug: "reg-a",
      title: "Reg A",
      json: false,
    });
    const pResult = await capture<{ ok: boolean; id: number }>(() =>
      runCmd(problemCommand as AnyCmd, "add", {
        workstream: "WS-reg-a",
        title: "P One",
        description: "desc",
        json: false,
      }),
    );
    const problemId = pResult.id;

    const ctx = await capture<{
      unscheduled: Array<Record<string, unknown>>;
      now: Array<Record<string, unknown>>;
    }>(() =>
      runCmd(contextCommand as AnyCmd, "run", {
        workstream: "WS-reg-a",
        tier: "unscheduled",
        json: false,
      }),
    );

    const entry = ctx.unscheduled[0]!;
    expect(entry.id).toBe(problemId);
    expect(entry.title).toBe("P One");
    expect("id" in entry).toBe(true);
    expect("title" in entry).toBe(true);
    expect(entry.problem).toBeUndefined();
  });

  test("scheduled (now) problem entry has non-null status at top level", async () => {
    await runCmd(workstreamCommand as AnyCmd, "add", {
      slug: "reg-a2",
      title: "Reg A2",
      json: false,
    });
    const pResult = await capture<{ ok: boolean; id: number }>(() =>
      runCmd(problemCommand as AnyCmd, "add", {
        workstream: "WS-reg-a2",
        title: "P Two",
        description: "desc",
        json: false,
      }),
    );
    const problemId = pResult.id;
    await runCmd(problemCommand as AnyCmd, "schedule", {
      id: String(problemId),
      tier: "now",
      json: false,
    });

    const ctx = await capture<{
      now: Array<Record<string, unknown>>;
    }>(() =>
      runCmd(contextCommand as AnyCmd, "run", {
        workstream: "WS-reg-a2",
        json: false,
      }),
    );

    expect(ctx.now.length).toBe(1);
    const entry = ctx.now[0]!;
    expect(entry.id).toBe(problemId);
    expect(entry.title).toBe("P Two");
    expect(entry.status).toBe("now");
    expect(entry.problem).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Regression OBS-030 (b): problem show includes solutions[] and latest_decision
// ---------------------------------------------------------------------------

describe("regression OBS-030 (b): problem show includes solutions and latest_decision", () => {
  test("problem show with no solutions has solutions[] and null latest_decision", async () => {
    await runCmd(workstreamCommand as AnyCmd, "add", {
      slug: "reg-b",
      title: "Reg B",
      json: false,
    });
    const pResult = await capture<{ ok: boolean; id: number }>(() =>
      runCmd(problemCommand as AnyCmd, "add", {
        workstream: "WS-reg-b",
        title: "Prob B",
        description: "desc",
        json: false,
      }),
    );
    const problemId = pResult.id;

    const result = await capture<Record<string, unknown>>(() =>
      runCmd(problemCommand as AnyCmd, "show", {
        id: String(problemId),
        json: false,
      }),
    );

    expect("solutions" in result).toBe(true);
    expect(Array.isArray(result.solutions)).toBe(true);
    expect((result.solutions as unknown[]).length).toBe(0);
    expect("latest_decision" in result).toBe(true);
    expect(result.latest_decision).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Schema validation: emit() rejects malformed payloads at construction time
// ---------------------------------------------------------------------------

describe("schema validation: emit() rejects malformed payloads", () => {
  test("OkWithIdOutput rejects payload missing 'id'", () => {
    expect(() => emit({ ok: true }, OkWithIdOutput)).toThrow();
  });

  test("ProblemShowOutput rejects payload missing 'solutions'", () => {
    const bareRow = { id: 1, title: "T", status: null };
    expect(() => emit(bareRow, ProblemShowOutput)).toThrow();
  });

  test("ContextOutput rejects payload missing required fields (workstream + seed_version)", () => {
    const malformed = {
      workstream: { slug: "ws" },
      now: [],
    };
    expect(() => emit(malformed, ContextOutput)).toThrow();
  });

  test("ContextOutput accepts payload with only now bucket (tier buckets are optional)", () => {
    const nowOnly = {
      workstream: { slug: "ws" },
      now: [],
      seed_version: "2026-04-30",
    };
    expect(() => emit(nowOnly, ContextOutput)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// SOL-context-now-only-default: --tier and --all flag behaviour
// ---------------------------------------------------------------------------

describe("context --tier / --all flag behaviour", () => {
  test("default invocation emits only 'now' bucket; done/next/later/unscheduled/abandoned absent", async () => {
    await runCmd(workstreamCommand as AnyCmd, "add", {
      slug: "tier-default",
      title: "Tier Default WS",
      json: false,
    });
    const pResult = await capture<{ ok: boolean; id: number }>(() =>
      runCmd(problemCommand as AnyCmd, "add", {
        workstream: "WS-tier-default",
        title: "Now Problem",
        description: "desc",
        json: false,
      }),
    );
    await runCmd(problemCommand as AnyCmd, "schedule", {
      id: String(pResult.id),
      tier: "now",
      json: false,
    });

    const ctx = await capture<Record<string, unknown>>(() =>
      runCmd(contextCommand as AnyCmd, "run", {
        workstream: "WS-tier-default",
        json: false,
      }),
    );

    expect(Array.isArray(ctx.now)).toBe(true);
    expect(ctx.done).toBeUndefined();
    expect(ctx.next).toBeUndefined();
    expect(ctx.later).toBeUndefined();
    expect(ctx.unscheduled).toBeUndefined();
    expect(ctx.abandoned).toBeUndefined();
    expect(ctx.recent_observations_unlinked).toBeUndefined();
    expect(ctx.workstream).toBeDefined();
    expect(typeof ctx.seed_version).toBe("string");
  });

  test("--all invocation emits all six tier buckets + recent_observations_unlinked", async () => {
    await runCmd(workstreamCommand as AnyCmd, "add", {
      slug: "tier-all",
      title: "Tier All WS",
      json: false,
    });
    await runCmd(problemCommand as AnyCmd, "add", {
      workstream: "WS-tier-all",
      title: "All Problem",
      description: "desc",
      json: false,
    });

    const ctx = await capture<Record<string, unknown>>(() =>
      runCmd(contextCommand as AnyCmd, "run", {
        workstream: "WS-tier-all",
        all: true,
        json: false,
      }),
    );

    expect(Array.isArray(ctx.now)).toBe(true);
    expect(Array.isArray(ctx.next)).toBe(true);
    expect(Array.isArray(ctx.later)).toBe(true);
    expect(Array.isArray(ctx.unscheduled)).toBe(true);
    expect(Array.isArray(ctx.done)).toBe(true);
    expect(Array.isArray(ctx.abandoned)).toBe(true);
    expect(Array.isArray(ctx.recent_observations_unlinked)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CRUX_COLLAB=1: guardAction enforcement
// ---------------------------------------------------------------------------

describe("CRUX_COLLAB=1: guardAction rejects mutations not allowed from workstream_list", () => {
  const ORIG_COLLAB = process.env.CRUX_COLLAB;
  const ORIG_VIEW_STATE = process.env.CRUX_VIEW_STATE_PATH;

  beforeEach(async () => {
    process.env.CRUX_COLLAB = "1";
    process.env.CRUX_VIEW_STATE_PATH = join(xdgDir, "nonexistent-view-state.json");
  });
  afterEach(() => {
    if (ORIG_COLLAB !== undefined) process.env.CRUX_COLLAB = ORIG_COLLAB;
    else delete process.env.CRUX_COLLAB;
    if (ORIG_VIEW_STATE !== undefined) process.env.CRUX_VIEW_STATE_PATH = ORIG_VIEW_STATE;
    else delete process.env.CRUX_VIEW_STATE_PATH;
  });

  test("ADD_PROBLEM from workstream_list throws ActionNotAllowedError", async () => {
    let thrown: unknown;
    try {
      await runCmd(problemCommand as AnyCmd, "add", {
        workstream: "any",
        title: "Any",
        description: "any",
        json: false,
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ActionNotAllowedError);
    expect((thrown as ActionNotAllowedError).attempted).toBe("ADD_PROBLEM");
  });

  test("ADD_OBSERVATION from workstream_list succeeds (global action)", async () => {
    await runCmd(workstreamCommand as AnyCmd, "add", {
      slug: "collab-ws",
      title: "Collab WS",
      json: false,
    });
    const result = await capture<{ ok: boolean; id: string }>(() =>
      runCmd(observationCommand as AnyCmd, "add", {
        workstream: "collab-ws",
        content: "Observed something",
        json: false,
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.id).toMatch(/^OBS-/);
  });

  test("ADD_WORKSTREAM from workstream_list succeeds", async () => {
    const result = await capture<{ ok: boolean; id: string }>(() =>
      runCmd(workstreamCommand as AnyCmd, "add", {
        slug: "new-ws",
        title: "New WS",
        json: false,
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.id).toBe("WS-new-ws");
  });

  test("CRUX_COLLAB absent — ADD_PROBLEM from workstream_list succeeds (direct mode)", async () => {
    delete process.env.CRUX_COLLAB;
    await runCmd(workstreamCommand as AnyCmd, "add", {
      slug: "direct-ws",
      title: "Direct WS",
      json: false,
    });
    const result = await capture<{ ok: boolean; id: number }>(() =>
      runCmd(problemCommand as AnyCmd, "add", {
        workstream: "WS-direct-ws",
        title: "Direct Prob",
        description: "desc",
        json: false,
      }),
    );
    expect(result.ok).toBe(true);
    expect(typeof result.id).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// Problem status mutations from workstream_dashboard
// ---------------------------------------------------------------------------

describe("CRUX_COLLAB=1: workstream_dashboard allows problem status mutations", () => {
  const ORIG_COLLAB = process.env.CRUX_COLLAB;
  const ORIG_VIEW_STATE = process.env.CRUX_VIEW_STATE_PATH;
  let viewStatePath: string;
  let testProblemId: number;

  beforeEach(async () => {
    viewStatePath = join(xdgDir, `view-state-problem-ops-${Date.now()}-${Math.random()}.json`);
    process.env.CRUX_VIEW_STATE_PATH = viewStatePath;
    mkdirSync(dirname(viewStatePath), { recursive: true });

    delete process.env.CRUX_COLLAB;
    await runCmd(workstreamCommand as AnyCmd, "add", {
      slug: "ws-prob-ops",
      title: "Prob Ops WS",
      json: false,
    });
    const pResult = await capture<{ ok: boolean; id: number }>(() =>
      runCmd(problemCommand as AnyCmd, "add", {
        workstream: "WS-ws-prob-ops",
        title: "Test Problem",
        description: "For testing ops",
        json: false,
      }),
    );
    testProblemId = pResult.id;

    const viewState = {
      status: "active",
      value: { viewing: "workstream_dashboard" },
      historyValue: {},
      context: { workstreamId: "WS-ws-prob-ops", problemId: null },
      children: {},
      revision: 0,
      lastAction: null,
      recentQueries: [],
    };
    writeFileSync(viewStatePath, JSON.stringify(viewState, null, 2), "utf8");

    process.env.CRUX_COLLAB = "1";
  });

  afterEach(() => {
    if (viewStatePath) {
      const fs = require("node:fs") as typeof import("node:fs");
      if (fs.existsSync(viewStatePath)) {
        fs.rmSync(viewStatePath, { force: true });
      }
    }
    if (ORIG_COLLAB !== undefined) process.env.CRUX_COLLAB = ORIG_COLLAB;
    else delete process.env.CRUX_COLLAB;
    if (ORIG_VIEW_STATE !== undefined) process.env.CRUX_VIEW_STATE_PATH = ORIG_VIEW_STATE;
    else delete process.env.CRUX_VIEW_STATE_PATH;
  });

  test("SCHEDULE_PROBLEM from workstream_dashboard succeeds", async () => {
    const result = await capture<{ ok: boolean }>(() =>
      runCmd(problemCommand as AnyCmd, "schedule", {
        id: String(testProblemId),
        tier: "now",
        json: false,
      }),
    );
    expect(result.ok).toBe(true);
  });

  test("UNSCHEDULE_PROBLEM from workstream_dashboard succeeds", async () => {
    await runCmd(problemCommand as AnyCmd, "schedule", {
      id: String(testProblemId),
      tier: "now",
      json: false,
    });
    const result = await capture<{ ok: boolean }>(() =>
      runCmd(problemCommand as AnyCmd, "unschedule", {
        id: String(testProblemId),
        json: false,
      }),
    );
    expect(result.ok).toBe(true);
  });

  test("MARK_PROBLEM_DONE from workstream_dashboard succeeds", async () => {
    delete process.env.CRUX_COLLAB;
    const { decisionCommand } = await import("../commands/decision.js");
    const sResult = await capture<{ ok: boolean; id: number }>(() =>
      runCmd(solutionCommand as AnyCmd, "add", {
        problem: String(testProblemId),
        title: "Test Solution",
        json: false,
      }),
    );
    const solId = sResult.id;
    await runCmd(decisionCommand as AnyCmd, "add", {
      workstream: "WS-ws-prob-ops",
      problem: String(testProblemId),
      chosen: String(solId),
      rationale: "best option",
      json: false,
    });
    await runCmd(solutionCommand as AnyCmd, "ship", {
      id: String(solId),
      json: false,
    });
    process.env.CRUX_COLLAB = "1";

    const result = await capture<{ ok: boolean }>(() =>
      runCmd(problemCommand as AnyCmd, "done", {
        id: String(testProblemId),
        json: false,
      }),
    );
    expect(result.ok).toBe(true);
  });

  test("ABANDON_PROBLEM from workstream_dashboard succeeds", async () => {
    const result = await capture<{ ok: boolean }>(() =>
      runCmd(problemCommand as AnyCmd, "abandon", {
        id: String(testProblemId),
        rationale: "Test abandon",
        json: false,
      }),
    );
    expect(result.ok).toBe(true);
  });

  test("ADD_SOLUTION from workstream_dashboard throws ActionNotAllowedError", async () => {
    let thrown: unknown;
    try {
      await runCmd(solutionCommand as AnyCmd, "add", {
        problem: String(testProblemId),
        title: "Test Solution",
        json: false,
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ActionNotAllowedError);
    expect((thrown as ActionNotAllowedError).attempted).toBe("ADD_SOLUTION");
  });
});

// ---------------------------------------------------------------------------
// recordMutation: revision bump + lastAction write on every mutation
// ---------------------------------------------------------------------------

describe("recordMutation: mutation success bumps revision and writes lastAction", () => {
  const ORIG_VIEW_STATE = process.env.CRUX_VIEW_STATE_PATH;
  const ORIG_COLLAB = process.env.CRUX_COLLAB;
  let viewStatePath: string;

  beforeEach(() => {
    viewStatePath = join(xdgDir, `view-state-${Date.now()}-${Math.random()}.json`);
    process.env.CRUX_VIEW_STATE_PATH = viewStatePath;
    delete process.env.CRUX_COLLAB;
  });

  afterEach(() => {
    if (ORIG_VIEW_STATE !== undefined) process.env.CRUX_VIEW_STATE_PATH = ORIG_VIEW_STATE;
    else delete process.env.CRUX_VIEW_STATE_PATH;
    if (ORIG_COLLAB !== undefined) process.env.CRUX_COLLAB = ORIG_COLLAB;
    else delete process.env.CRUX_COLLAB;
  });

  function readViewMeta(): { revision?: number; lastAction?: { kind: string; ts: number } | null } {
    const fs = require("node:fs") as typeof import("node:fs");
    if (!fs.existsSync(viewStatePath)) return {};
    return JSON.parse(fs.readFileSync(viewStatePath, "utf8")) as {
      revision?: number;
      lastAction?: { kind: string; ts: number } | null;
    };
  }

  test("ADD_WORKSTREAM bumps revision from 0 → 1 and writes lastAction.kind=ADD_WORKSTREAM", async () => {
    expect(readViewMeta().revision ?? 0).toBe(0);
    await runCmd(workstreamCommand as AnyCmd, "add", {
      slug: "rev-test",
      title: "Rev Test",
      json: false,
    });
    const meta = readViewMeta();
    expect(meta.revision).toBe(1);
    expect(meta.lastAction?.kind).toBe("ADD_WORKSTREAM");
    expect(typeof meta.lastAction?.ts).toBe("number");
  });

  test("two consecutive mutations increment revision (1 → 2)", async () => {
    await runCmd(workstreamCommand as AnyCmd, "add", {
      slug: "rev-two",
      title: "Rev Two",
      json: false,
    });
    expect(readViewMeta().revision).toBe(1);
    await runCmd(problemCommand as AnyCmd, "add", {
      workstream: "WS-rev-two",
      title: "P1",
      description: "d",
      json: false,
    });
    const meta = readViewMeta();
    expect(meta.revision).toBe(2);
    expect(meta.lastAction?.kind).toBe("ADD_PROBLEM");
  });

  test("CRUX_COLLAB=1 also bumps revision (unconditional, gated only on guardAction)", async () => {
    process.env.CRUX_COLLAB = "1";
    await runCmd(workstreamCommand as AnyCmd, "add", {
      slug: "collab-rev",
      title: "Collab Rev",
      json: false,
    });
    const meta = readViewMeta();
    expect(meta.revision).toBe(1);
    expect(meta.lastAction?.kind).toBe("ADD_WORKSTREAM");
  });
});
