/**
 * Action schemas for the collab-mode action bus.
 *
 * ViewAction  = the 5 view-machine events (navigation)
 * MutationAction = data write actions
 * Action = union of both
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// ViewAction — mirrors ViewEventSchema in machine.ts
// ---------------------------------------------------------------------------

export const SelectWorkstreamAction = z.object({
  kind: z.literal("SELECT_WORKSTREAM"),
  payload: z.object({ id: z.string() }),
});
export const OpenProblemAction = z.object({
  kind: z.literal("OPEN_PROBLEM"),
  payload: z.object({ slug: z.string() }),
});
export const SelectIntakeAction = z.object({
  kind: z.literal("SELECT_INTAKE"),
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
  BackAction,
]);

export type ViewAction = z.infer<typeof ViewActionSchema>;

// ---------------------------------------------------------------------------
// MutationAction
// ---------------------------------------------------------------------------

export const AddProblemAction = z.object({
  kind: z.literal("ADD_PROBLEM"),
  payload: z.object({
    workstream: z.string(),
    title: z.string(),
    description: z.string(),
  }),
});
export const ScheduleProblemAction = z.object({
  kind: z.literal("SCHEDULE_PROBLEM"),
  payload: z.object({ id: z.union([z.string(), z.number()]), tier: z.string() }),
});
export const UnscheduleProblemAction = z.object({
  kind: z.literal("UNSCHEDULE_PROBLEM"),
  payload: z.object({ id: z.union([z.string(), z.number()]) }),
});
export const MarkProblemDoneAction = z.object({
  kind: z.literal("MARK_PROBLEM_DONE"),
  payload: z.object({ id: z.union([z.string(), z.number()]) }),
});
export const AbandonProblemAction = z.object({
  kind: z.literal("ABANDON_PROBLEM"),
  payload: z.object({ id: z.union([z.string(), z.number()]), rationale: z.string() }),
});
export const AddSolutionAction = z.object({
  kind: z.literal("ADD_SOLUTION"),
  payload: z.object({
    problem: z.union([z.string(), z.number()]),
    title: z.string(),
    description: z.string().optional(),
  }),
});
export const ShipSolutionAction = z.object({
  kind: z.literal("SHIP_SOLUTION"),
  payload: z.object({ id: z.union([z.string(), z.number()]) }),
});
export const EditSolutionAction = z.object({
  kind: z.literal("EDIT_SOLUTION"),
  payload: z.object({
    solutionId: z.union([z.string(), z.number()]),
    description: z.string().optional(),
    title: z.string().optional(),
  }),
});
export const AddDecisionAction = z.object({
  kind: z.literal("ADD_DECISION"),
  payload: z.object({
    problem: z.union([z.string(), z.number()]),
    chosen: z.union([z.string(), z.number()]),
    rationale: z.string(),
    rejected: z.array(z.union([z.string(), z.number()])).optional(),
    context: z.string().optional(),
  }),
});
export const AddOutcomeAction = z.object({
  kind: z.literal("ADD_OUTCOME"),
  payload: z.object({
    solution: z.union([z.string(), z.number()]),
    observedImpact: z.string(),
    expectedImpact: z.string().optional(),
    learnings: z.string().optional(),
    followUpProblemIds: z.array(z.union([z.string(), z.number()])).optional(),
  }),
});
export const AddObservationAction = z.object({
  kind: z.literal("ADD_OBSERVATION"),
  payload: z.object({
    workstream: z.string(),
    content: z.string(),
    source: z.string().optional(),
    sourceType: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }),
});
export const ArchiveObservationAction = z.object({
  kind: z.literal("ARCHIVE_OBSERVATION"),
  payload: z.object({ id: z.string(), rationale: z.string().optional() }),
});
export const AddEvidenceAction = z.object({
  kind: z.literal("ADD_EVIDENCE"),
  payload: z.object({
    observation: z.string(),
    problem: z.union([z.string(), z.number()]),
    note: z.string().optional(),
  }),
});
export const AddEliminationAction = z.object({
  kind: z.literal("ADD_ELIMINATION"),
  payload: z.object({
    solutions: z.array(z.union([z.string(), z.number()])),
    rationale: z.string(),
    context: z.string().optional(),
  }),
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
  EditSolutionAction,
  AddDecisionAction,
  AddOutcomeAction,
  AddObservationAction,
  ArchiveObservationAction,
  AddEvidenceAction,
  AddEliminationAction,
  AddWorkstreamAction,
  RenameWorkstreamAction,
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
  "EDIT_SOLUTION",
  "ADD_DECISION",
  "ADD_OUTCOME",
  "ADD_OBSERVATION",
  "ARCHIVE_OBSERVATION",
  "ADD_EVIDENCE",
  "ADD_ELIMINATION",
  "ADD_WORKSTREAM",
  "RENAME_WORKSTREAM",
  "RENAME_OBSERVATION",
];

export function isViewAction(action: Action): action is ViewAction {
  return VIEW_ACTION_KINDS.includes(action.kind as ViewActionKind);
}

// ---------------------------------------------------------------------------
// Typed payload helpers
// ---------------------------------------------------------------------------

export type AddObservationPayload = z.infer<typeof AddObservationAction>["payload"];
export type ArchiveObservationPayload = z.infer<typeof ArchiveObservationAction>["payload"];
export type AddProblemPayload = z.infer<typeof AddProblemAction>["payload"];
export type ScheduleProblemPayload = z.infer<typeof ScheduleProblemAction>["payload"];
export type UnscheduleProblemPayload = z.infer<typeof UnscheduleProblemAction>["payload"];
export type MarkProblemDonePayload = z.infer<typeof MarkProblemDoneAction>["payload"];
export type AbandonProblemPayload = z.infer<typeof AbandonProblemAction>["payload"];
export type AddSolutionPayload = z.infer<typeof AddSolutionAction>["payload"];
export type ShipSolutionPayload = z.infer<typeof ShipSolutionAction>["payload"];
export type EditSolutionPayload = z.infer<typeof EditSolutionAction>["payload"];
export type AddDecisionPayload = z.infer<typeof AddDecisionAction>["payload"];
export type AddOutcomePayload = z.infer<typeof AddOutcomeAction>["payload"];
export type AddEvidencePayload = z.infer<typeof AddEvidenceAction>["payload"];
export type AddEliminationPayload = z.infer<typeof AddEliminationAction>["payload"];
export type AddWorkstreamPayload = z.infer<typeof AddWorkstreamAction>["payload"];
export type RenameWorkstreamPayload = z.infer<typeof RenameWorkstreamAction>["payload"];
export type SelectWorkstreamPayload = z.infer<typeof SelectWorkstreamAction>["payload"];

export type MutationPayload<K extends MutationActionKind> = Extract<
  MutationAction,
  { kind: K }
>["payload"];
