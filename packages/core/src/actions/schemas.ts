/**
 * Action schemas for the collab-mode action bus.
 *
 * ViewAction  = the 5 view-machine events (navigation)
 * MutationAction = ~22 kinds that call transitions (data writes)
 * Action = union of both
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// ViewAction — mirrors ViewEventSchema in machine.ts
// ---------------------------------------------------------------------------

export const SelectWorkstreamAction = z.object({
  kind: z.literal("SELECT_WORKSTREAM"),
  payload: z.object({ slug: z.string() }),
});
export const OpenProblemAction = z.object({
  kind: z.literal("OPEN_PROBLEM"),
  payload: z.object({ slug: z.string() }),
});
export const SelectIntakeAction = z.object({
  kind: z.literal("SELECT_INTAKE"),
  payload: z.object({}).optional(),
});
export const SelectIdeasAction = z.object({
  kind: z.literal("SELECT_IDEAS"),
  payload: z.object({}).optional(),
});
export const BackAction = z.object({
  kind: z.literal("BACK"),
  payload: z.object({}).optional(),
});

export const ViewActionSchema = z.discriminatedUnion("kind", [
  SelectWorkstreamAction,
  OpenProblemAction,
  SelectIntakeAction,
  SelectIdeasAction,
  BackAction,
]);

export type ViewAction = z.infer<typeof ViewActionSchema>;

// ---------------------------------------------------------------------------
// MutationAction — 22 kinds
// ---------------------------------------------------------------------------

export const AddProblemAction = z.object({
  kind: z.literal("ADD_PROBLEM"),
  payload: z.object({
    workstream: z.string(),
    slug: z.string(),
    title: z.string(),
    description: z.string(),
  }),
});
export const ScheduleProblemAction = z.object({
  kind: z.literal("SCHEDULE_PROBLEM"),
  payload: z.object({ slug: z.string(), tier: z.string() }),
});
export const UnscheduleProblemAction = z.object({
  kind: z.literal("UNSCHEDULE_PROBLEM"),
  payload: z.object({ slug: z.string() }),
});
export const MarkProblemDoneAction = z.object({
  kind: z.literal("MARK_PROBLEM_DONE"),
  payload: z.object({ slug: z.string() }),
});
export const AbandonProblemAction = z.object({
  kind: z.literal("ABANDON_PROBLEM"),
  payload: z.object({ slug: z.string(), rationale: z.string() }),
});
export const AddSolutionAction = z.object({
  kind: z.literal("ADD_SOLUTION"),
  payload: z.object({
    problem: z.string(),
    slug: z.string(),
    title: z.string(),
    description: z.string().optional(),
  }),
});
export const ShipSolutionAction = z.object({
  kind: z.literal("SHIP_SOLUTION"),
  payload: z.object({ slug: z.string() }),
});
export const PromoteIdeaAction = z.object({
  kind: z.literal("PROMOTE_IDEA"),
  payload: z.object({
    slug: z.string(),
    workstream: z.string(),
    problem: z.string(),
    title: z.string(),
  }),
});
export const AddDecisionAction = z.object({
  kind: z.literal("ADD_DECISION"),
  payload: z.object({
    problem: z.string(),
    chosen: z.string(),
    rationale: z.string(),
    rejected: z.array(z.string()).optional(),
  }),
});
export const AddOutcomeAction = z.object({
  kind: z.literal("ADD_OUTCOME"),
  payload: z.object({
    solution: z.string(),
    summary: z.string(),
    followUpProblemIds: z.array(z.string()).optional(),
  }),
});
export const AddObservationAction = z.object({
  kind: z.literal("ADD_OBSERVATION"),
  payload: z.object({ workstream: z.string(), content: z.string(), source: z.string().optional() }),
});
export const ArchiveObservationAction = z.object({
  kind: z.literal("ARCHIVE_OBSERVATION"),
  payload: z.object({ id: z.string() }),
});
export const AddIdeaAction = z.object({
  kind: z.literal("ADD_IDEA"),
  payload: z.object({
    workstream: z.string(),
    slug: z.string(),
    title: z.string(),
    description: z.string().optional(),
  }),
});
export const ArchiveIdeaAction = z.object({
  kind: z.literal("ARCHIVE_IDEA"),
  payload: z.object({ slug: z.string() }),
});
export const AddEvidenceAction = z.object({
  kind: z.literal("ADD_EVIDENCE"),
  payload: z.object({ observation: z.string(), problem: z.string(), note: z.string().optional() }),
});
export const AddEliminationAction = z.object({
  kind: z.literal("ADD_ELIMINATION"),
  payload: z.object({ solution: z.string(), rationale: z.string() }),
});
export const AddThemeAction = z.object({
  kind: z.literal("ADD_THEME"),
  payload: z.object({ workstream: z.string(), slug: z.string(), title: z.string() }),
});
export const AttachThemeAction = z.object({
  kind: z.literal("ATTACH_THEME"),
  payload: z.object({ theme: z.string(), solution: z.string() }),
});
export const AddWorkstreamAction = z.object({
  kind: z.literal("ADD_WORKSTREAM"),
  payload: z.object({ slug: z.string(), title: z.string(), description: z.string().optional() }),
});
export const RenameWorkstreamAction = z.object({
  kind: z.literal("RENAME_WORKSTREAM"),
  payload: z.object({
    oldSlug: z.string(),
    newSlug: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
  }),
});
export const RenameProblemAction = z.object({
  kind: z.literal("RENAME_PROBLEM"),
  payload: z.object({
    oldSlug: z.string(),
    newSlug: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
  }),
});
export const RenameSolutionAction = z.object({
  kind: z.literal("RENAME_SOLUTION"),
  payload: z.object({
    oldSlug: z.string(),
    newSlug: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
  }),
});
export const RenameObservationAction = z.object({
  kind: z.literal("RENAME_OBSERVATION"),
  payload: z.object({ id: z.string(), content: z.string() }),
});

export const MutationActionSchema = z.discriminatedUnion("kind", [
  AddProblemAction,
  ScheduleProblemAction,
  UnscheduleProblemAction,
  MarkProblemDoneAction,
  AbandonProblemAction,
  AddSolutionAction,
  ShipSolutionAction,
  PromoteIdeaAction,
  AddDecisionAction,
  AddOutcomeAction,
  AddObservationAction,
  ArchiveObservationAction,
  AddIdeaAction,
  ArchiveIdeaAction,
  AddEvidenceAction,
  AddEliminationAction,
  AddThemeAction,
  AttachThemeAction,
  AddWorkstreamAction,
  RenameWorkstreamAction,
  RenameProblemAction,
  RenameSolutionAction,
  RenameObservationAction,
]);

export type MutationAction = z.infer<typeof MutationActionSchema>;

// ---------------------------------------------------------------------------
// Combined Action
// ---------------------------------------------------------------------------

export const ActionSchema = z.union([ViewActionSchema, MutationActionSchema]);
export type Action = z.infer<typeof ActionSchema>;

export type ActionKind = Action["kind"];
export type ViewActionKind = ViewAction["kind"];
export type MutationActionKind = MutationAction["kind"];

export const VIEW_ACTION_KINDS: ViewActionKind[] = [
  "SELECT_WORKSTREAM",
  "OPEN_PROBLEM",
  "SELECT_INTAKE",
  "SELECT_IDEAS",
  "BACK",
];

export const MUTATION_ACTION_KINDS: MutationActionKind[] = [
  "ADD_PROBLEM",
  "SCHEDULE_PROBLEM",
  "UNSCHEDULE_PROBLEM",
  "MARK_PROBLEM_DONE",
  "ABANDON_PROBLEM",
  "ADD_SOLUTION",
  "SHIP_SOLUTION",
  "PROMOTE_IDEA",
  "ADD_DECISION",
  "ADD_OUTCOME",
  "ADD_OBSERVATION",
  "ARCHIVE_OBSERVATION",
  "ADD_IDEA",
  "ARCHIVE_IDEA",
  "ADD_EVIDENCE",
  "ADD_ELIMINATION",
  "ADD_THEME",
  "ATTACH_THEME",
  "ADD_WORKSTREAM",
  "RENAME_WORKSTREAM",
  "RENAME_PROBLEM",
  "RENAME_SOLUTION",
  "RENAME_OBSERVATION",
];

export function isViewAction(action: Action): action is ViewAction {
  return VIEW_ACTION_KINDS.includes(action.kind as ViewActionKind);
}
