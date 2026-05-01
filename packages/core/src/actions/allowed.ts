/**
 * Per-view action allow-lists.
 *
 * Returns { allowedView, allowedMutation, globals } for the current state leaf.
 * Globals are actions permitted in every view (ADD_OBSERVATION, ADD_IDEA, BACK).
 */
import type { ViewActionKind, MutationActionKind } from "./schemas.js";

export type AllowedActions = {
  allowedView: ViewActionKind[];
  allowedMutation: MutationActionKind[];
  globals: (ViewActionKind | MutationActionKind)[];
};

const GLOBALS: (ViewActionKind | MutationActionKind)[] = [
  "ADD_OBSERVATION",
  "ADD_IDEA",
  "BACK",
  "SELECT_WORKSTREAM",
  "OPEN_PROBLEM",
  "SELECT_INTAKE",
  "SELECT_IDEAS",
];

const VIEW_ALLOWED: Record<string, AllowedActions> = {
  workstream_list: {
    allowedView: ["SELECT_WORKSTREAM"],
    allowedMutation: ["ADD_WORKSTREAM", "RENAME_WORKSTREAM"],
    globals: GLOBALS,
  },
  workstream_dashboard: {
    allowedView: ["OPEN_PROBLEM", "SELECT_INTAKE", "SELECT_IDEAS", "BACK"],
    allowedMutation: [
      "ADD_PROBLEM",
      "ADD_OBSERVATION",
      "ADD_IDEA",
      "SCHEDULE_PROBLEM",
      "UNSCHEDULE_PROBLEM",
      "MARK_PROBLEM_DONE",
      "ABANDON_PROBLEM",
      "RENAME_PROBLEM",
    ],
    globals: GLOBALS,
  },
  problem_detail: {
    allowedView: ["BACK"],
    allowedMutation: [
      "ADD_SOLUTION",
      "ADD_EVIDENCE",
      "ADD_DECISION",
      "ADD_ELIMINATION",
      "ADD_OUTCOME",
      "SCHEDULE_PROBLEM",
      "UNSCHEDULE_PROBLEM",
      "MARK_PROBLEM_DONE",
      "ABANDON_PROBLEM",
      "RENAME_PROBLEM",
      "SHIP_SOLUTION",
      "PROMOTE_IDEA",
    ],
    globals: GLOBALS,
  },
  intake_queue: {
    allowedView: ["BACK"],
    allowedMutation: ["ARCHIVE_OBSERVATION", "ADD_OBSERVATION"],
    globals: GLOBALS,
  },
  ideas_queue: {
    allowedView: ["BACK"],
    allowedMutation: ["ARCHIVE_IDEA", "ADD_IDEA", "RENAME_IDEA"],
    globals: GLOBALS,
  },
};

/**
 * Extract the leaf state name from XState's nested value object.
 * e.g. { viewing: "workstream_list" } → "workstream_list"
 */
export function leafStateName(value: unknown): string {
  if (typeof value === "string") return value;
  let cur: unknown = value;
  let last = "";
  while (cur && typeof cur === "object") {
    const obj = cur as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) break;
    const key = keys[0]!;
    last = key;
    cur = obj[key];
  }
  if (typeof cur === "string") return cur;
  return last;
}

/**
 * Return the allowed actions for the given view state value.
 * Falls back to workstream_list if the state is unknown.
 */
export function getAllowedActions(stateValue: unknown): AllowedActions {
  const leaf = leafStateName(stateValue);
  return VIEW_ALLOWED[leaf] ?? VIEW_ALLOWED["workstream_list"]!;
}

/**
 * Returns true if `kind` is allowed in the given state (including globals).
 */
export function isActionAllowed(kind: string, stateValue: unknown): boolean {
  const allowed = getAllowedActions(stateValue);
  const all = [...allowed.allowedView, ...allowed.allowedMutation, ...allowed.globals];
  // Deduplicate: globals may overlap with per-view lists
  return [...new Set(all)].includes(kind as ViewActionKind | MutationActionKind);
}
