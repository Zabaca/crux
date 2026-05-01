/**
 * Integration tests for CLI commands via direct module import.
 *
 * Each test gets its own ephemeral libSQL db (from createTestDb()), injected
 * into the core singleton via setDb(). Output is captured via setCaptureWriter()
 * rather than stdout interception. No subprocess spawn.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// These must be imported before the command modules so that the singleton
// is not yet initialized when we call setDb() in beforeEach.
import { setDb } from "@crux/core/db";
import { createTestDb, type CruxTestDb } from "@crux/core/db/test-utils";
import { users } from "@crux/core/db/schema";
import { slugifyName } from "@crux/core/config";
import { setCaptureWriter, setJsonMode, emit } from "../output.js";
import { OkWithIdOutput, ProblemShowOutput, ContextOutput } from "@crux/core/validation";
import { ActionNotAllowedError } from "@crux/core/actions";

// Command modules — imported after the singleton helpers above.
import { workstreamCommand } from "../commands/workstream.js";
import { problemCommand } from "../commands/problem.js";
import { observationCommand } from "../commands/observation.js";
import { evidenceCommand } from "../commands/evidence.js";
import { contextCommand } from "../commands/context.js";
import { ideaCommand } from "../commands/idea.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AnyCmd = {
  run?: (ctx: { args: Record<string, unknown>; rawArgs?: string[] }) => Promise<void>;
  subCommands?: Record<string, AnyCmd>;
};

// Helper: call a subcommand's run handler directly.
async function runCmd(parent: AnyCmd, sub: string, args: Record<string, unknown>): Promise<void> {
  let cmd: AnyCmd;
  if (sub === "run") {
    // Top-level command with its own run (no subCommands), e.g. contextCommand.
    cmd = parent;
  } else {
    cmd = parent.subCommands![sub]!;
  }
  await cmd.run!({ args, rawArgs: [] });
}

// Helper: run a command and capture the emitted payload.
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

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

const TEST_USER = { id: "USR-test", slug: "test", name: "Test User", email: "test@example.com" };

let db: CruxTestDb;
let testCleanup: () => void;
let xdgDir: string;

beforeEach(async () => {
  // 1. Spin up ephemeral db and inject into core singleton.
  ({ db, cleanup: testCleanup } = await createTestDb());
  setDb(db as unknown as Parameters<typeof setDb>[0]);

  // 2. Seed a user row so commands can resolve requireUser().user.id.
  await db.insert(users).values(TEST_USER);

  // 3. Write a user config to a temp XDG dir so requireUser() returns the test user.
  xdgDir = mkdtempSync(join(tmpdir(), "crux-xdg-"));
  const cfgDir = join(xdgDir, "crux");
  mkdirSync(cfgDir, { recursive: true });
  writeFileSync(
    join(cfgDir, "config.toml"),
    `[user]\nid = "${TEST_USER.id}"\nslug = "${TEST_USER.slug}"\nname = "${TEST_USER.name}"\nemail = "${TEST_USER.email}"\n`,
  );
  process.env.XDG_CONFIG_HOME = xdgDir;

  // 4. Reset output state.
  setJsonMode(false);
  setCaptureWriter(null);
});

afterEach(() => {
  // Reset db singleton so next test initialises fresh.
  setDb(null);
  // Clean up temp dirs.
  testCleanup();
  rmSync(xdgDir, { recursive: true, force: true });
  // Clean up env.
  delete process.env.XDG_CONFIG_HOME;
  // Reset output state.
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

    // problem add
    const pResult = await capture<{ ok: boolean; id: string }>(() =>
      runCmd(problemCommand as AnyCmd, "add", {
        workstream: "smoke",
        slug: "first-problem",
        title: "First Problem",
        description: "A problem",
        json: false,
      }),
    );
    expect(pResult.ok).toBe(true);
    expect(pResult.id).toBe("PRB-first-problem");

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

    // evidence link
    const evResult = await capture<{ ok: boolean; id: string }>(() =>
      runCmd(evidenceCommand as AnyCmd, "link", {
        observation: obsId,
        problem: "first-problem",
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
        workstream: "smoke",
        tier: "unscheduled",
        json: false,
      }),
    );
    expect(ctx.workstream.slug).toBe("smoke");
    expect(ctx.unscheduled.length).toBe(1);
    expect(ctx.unscheduled[0]!.slug).toBe("first-problem");
  });
});

// ---------------------------------------------------------------------------
// Regression OBS-030 (a): context entries have slug/title/status at top level
// ---------------------------------------------------------------------------

describe("regression OBS-030 (a): context problem entries spread slug/title/status", () => {
  test("unscheduled problem entry has non-null slug and title at top level", async () => {
    // Set up a workstream with a problem.
    await runCmd(workstreamCommand as AnyCmd, "add", {
      slug: "reg-a",
      title: "Reg A",
      json: false,
    });
    await runCmd(problemCommand as AnyCmd, "add", {
      workstream: "reg-a",
      slug: "p-one",
      title: "P One",
      description: "desc",
      json: false,
    });

    const ctx = await capture<{
      unscheduled: Array<Record<string, unknown>>;
      now: Array<Record<string, unknown>>;
    }>(() =>
      runCmd(contextCommand as AnyCmd, "run", {
        workstream: "reg-a",
        tier: "unscheduled",
        json: false,
      }),
    );

    const entry = ctx.unscheduled[0]!;
    expect(entry.slug).toBe("p-one");
    expect(entry.title).toBe("P One");
    // status is null for unscheduled — the field must exist directly on entry
    expect("slug" in entry).toBe(true);
    expect("title" in entry).toBe(true);
    // Must NOT be nested under a 'problem' key
    expect(entry.problem).toBeUndefined();
  });

  test("scheduled (now) problem entry has non-null status at top level", async () => {
    await runCmd(workstreamCommand as AnyCmd, "add", {
      slug: "reg-a2",
      title: "Reg A2",
      json: false,
    });
    await runCmd(problemCommand as AnyCmd, "add", {
      workstream: "reg-a2",
      slug: "p-two",
      title: "P Two",
      description: "desc",
      json: false,
    });
    await runCmd(problemCommand as AnyCmd, "schedule", {
      slug: "p-two",
      tier: "now",
      json: false,
    });

    const ctx = await capture<{
      now: Array<Record<string, unknown>>;
    }>(() =>
      runCmd(contextCommand as AnyCmd, "run", {
        workstream: "reg-a2",
        json: false,
      }),
    );

    expect(ctx.now.length).toBe(1);
    const entry = ctx.now[0]!;
    expect(entry.slug).toBe("p-two");
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
    await runCmd(problemCommand as AnyCmd, "add", {
      workstream: "reg-b",
      slug: "prob-b",
      title: "Prob B",
      description: "desc",
      json: false,
    });

    const result = await capture<Record<string, unknown>>(() =>
      runCmd(problemCommand as AnyCmd, "show", {
        slug: "prob-b",
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
// Regression OBS-030 (c): idea promote uses slugifyName(title) not idea slug
// ---------------------------------------------------------------------------

describe("regression OBS-030 (c): idea promote slugs the title, not the idea slug", () => {
  test("promoted solution slug equals slugifyName(title)", async () => {
    await runCmd(workstreamCommand as AnyCmd, "add", {
      slug: "reg-c",
      title: "Reg C",
      json: false,
    });
    await runCmd(problemCommand as AnyCmd, "add", {
      workstream: "reg-c",
      slug: "prob-c",
      title: "Prob C",
      description: "desc",
      json: false,
    });
    await runCmd(ideaCommand as AnyCmd, "add", {
      workstream: "reg-c",
      slug: "my-idea",
      title: "My Idea",
      json: false,
    });

    const solutionTitle = "Some Great Solution";
    const expectedSlug = slugifyName(solutionTitle); // "some-great-solution"

    const result = await capture<{ ok: boolean; id: string }>(() =>
      runCmd(ideaCommand as AnyCmd, "promote", {
        slug: "my-idea",
        workstream: "reg-c",
        problem: "prob-c",
        title: solutionTitle,
        json: false,
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.id).toBe(`SOL-${expectedSlug}`);
    // The solution slug must NOT be the idea slug "my-idea".
    expect(result.id).not.toBe("SOL-my-idea");
  });
});

// ---------------------------------------------------------------------------
// Schema validation: emit() rejects malformed payloads at construction time
// ---------------------------------------------------------------------------

describe("schema validation: emit() rejects malformed payloads", () => {
  test("OkWithIdOutput rejects payload missing 'id'", () => {
    // { ok: true } with no `id` must throw.
    expect(() => emit({ ok: true }, OkWithIdOutput)).toThrow();
  });

  test("ProblemShowOutput rejects payload missing 'solutions'", () => {
    // A bare problem row (no solutions[]) must fail with path `solutions: Required`.
    const bareRow = { id: "PRB-test", slug: "test", title: "T", status: null };
    expect(() => emit(bareRow, ProblemShowOutput)).toThrow();
  });

  test("ContextOutput rejects payload missing required fields (workstream + seed_version)", () => {
    // Omitting seed_version must throw — it is still required.
    const malformed = {
      workstream: { slug: "ws" },
      now: [],
      // seed_version deliberately omitted
    };
    expect(() => emit(malformed, ContextOutput)).toThrow();
  });

  test("ContextOutput accepts payload with only now bucket (tier buckets are optional)", () => {
    // Default (now-only) shape must pass validation.
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
    // Add a problem and schedule it 'now'.
    await runCmd(problemCommand as AnyCmd, "add", {
      workstream: "tier-default",
      slug: "prob-now",
      title: "Now Problem",
      description: "desc",
      json: false,
    });
    await runCmd(problemCommand as AnyCmd, "schedule", {
      slug: "prob-now",
      tier: "now",
      json: false,
    });

    const ctx = await capture<Record<string, unknown>>(() =>
      runCmd(contextCommand as AnyCmd, "run", {
        workstream: "tier-default",
        json: false,
        // no tier / no all — defaults to now-only
      }),
    );

    expect(Array.isArray(ctx.now)).toBe(true);
    expect(ctx.done).toBeUndefined();
    expect(ctx.next).toBeUndefined();
    expect(ctx.later).toBeUndefined();
    expect(ctx.unscheduled).toBeUndefined();
    expect(ctx.abandoned).toBeUndefined();
    expect(ctx.recent_observations_unlinked).toBeUndefined();
    expect(ctx.unpromoted_ideas).toBeUndefined();
    expect(ctx.themes).toBeUndefined();
    // Workstream and seed_version always present.
    expect(ctx.workstream).toBeDefined();
    expect(typeof ctx.seed_version).toBe("string");
  });

  test("--all invocation emits all six tier buckets + recent_observations_unlinked + unpromoted_ideas + themes", async () => {
    await runCmd(workstreamCommand as AnyCmd, "add", {
      slug: "tier-all",
      title: "Tier All WS",
      json: false,
    });
    await runCmd(problemCommand as AnyCmd, "add", {
      workstream: "tier-all",
      slug: "prob-all",
      title: "All Problem",
      description: "desc",
      json: false,
    });

    const ctx = await capture<Record<string, unknown>>(() =>
      runCmd(contextCommand as AnyCmd, "run", {
        workstream: "tier-all",
        all: true,
        json: false,
      }),
    );

    // All six tier buckets present.
    expect(Array.isArray(ctx.now)).toBe(true);
    expect(Array.isArray(ctx.next)).toBe(true);
    expect(Array.isArray(ctx.later)).toBe(true);
    expect(Array.isArray(ctx.unscheduled)).toBe(true);
    expect(Array.isArray(ctx.done)).toBe(true);
    expect(Array.isArray(ctx.abandoned)).toBe(true);
    // Top-level extras present.
    expect(Array.isArray(ctx.recent_observations_unlinked)).toBe(true);
    expect(Array.isArray(ctx.unpromoted_ideas)).toBe(true);
    expect(Array.isArray(ctx.themes)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CRUX_COLLAB=1: guardAction enforcement
// ---------------------------------------------------------------------------

describe("CRUX_COLLAB=1: guardAction rejects mutations not allowed from workstream_list", () => {
  const ORIG_COLLAB = process.env.CRUX_COLLAB;
  const ORIG_VIEW_STATE = process.env.CRUX_VIEW_STATE_PATH;

  beforeEach(async () => {
    // Start from workstream_list (no view-state file = initial state = workstream_list)
    process.env.CRUX_COLLAB = "1";
    // Point view state to a non-existent file so initial state is workstream_list
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
        slug: "any",
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
    // First create the workstream directly without guard
    await runCmd(workstreamCommand as AnyCmd, "add", {
      slug: "collab-ws",
      title: "Collab WS",
      json: false,
    });
    // ADD_OBSERVATION is a global — must not throw from any view
    // But ADD_WORKSTREAM is allowed from workstream_list, so this passes
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
    const result = await capture<{ ok: boolean; id: string }>(() =>
      runCmd(problemCommand as AnyCmd, "add", {
        workstream: "direct-ws",
        slug: "direct-prob",
        title: "Direct Prob",
        description: "desc",
        json: false,
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.id).toBe("PRB-direct-prob");
  });
});
