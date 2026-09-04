/**
 * Action schemas for the collab-mode action bus.
 *
 * ViewAction  = the 5 view-machine events (navigation)
 * MutationAction = data write actions
 * Action = union of both
 */
import { z } from "zod";

import { ATTEMPT_CLOSED_STATUSES } from "../transitions/attempt.js";

// ---------------------------------------------------------------------------
// ViewAction — mirrors ViewEventSchema in machine.ts
// ---------------------------------------------------------------------------

export const SelectWorkstreamAction = z.object({
  kind: z.literal("SELECT_WORKSTREAM"),
  payload: z.object({ id: z.string() }),
});
export const OpenProblemAction = z.object({
  kind: z.literal("OPEN_PROBLEM"),
  // `id`, matching OpenProblemEvent in machine.ts — dispatch spreads this
  // payload straight into the view event, so any other key is unroutable.
  payload: z.object({ id: z.string() }),
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
  payload: z.object({ id: z.union([z.string(), z.number()]), stage: z.string() }),
});
export const UnscheduleProblemAction = z.object({
  kind: z.literal("UNSCHEDULE_PROBLEM"),
  payload: z.object({ id: z.union([z.string(), z.number()]) }),
});
export const AbandonProblemAction = z.object({
  kind: z.literal("ABANDON_PROBLEM"),
  payload: z.object({ id: z.union([z.string(), z.number()]), rationale: z.string() }),
});
/**
 * Filing an Attempt. `.strict()` is the load-bearing part: an Attempt has
 * nowhere to record a description of the work (ADR-0012), and a stripped-away
 * key would let a caller believe one was stored. An unrecognised key is a
 * refusal, not a silent drop.
 */
export const AddAttemptAction = z.object({
  kind: z.literal("ADD_ATTEMPT"),
  payload: z
    .object({
      problem: z.union([z.string(), z.number()]),
      ref: z.string(),
      label: z.string(),
    })
    .strict(),
});
export const CloseAttemptAction = z.object({
  kind: z.literal("CLOSE_ATTEMPT"),
  payload: z
    .object({
      id: z.string(),
      status: z.enum(ATTEMPT_CLOSED_STATUSES),
      closingNote: z.string(),
    })
    .strict(),
});
export const CompleteProblemAction = z.object({
  kind: z.literal("COMPLETE_PROBLEM"),
  payload: z.object({
    problem: z.union([z.string(), z.number()]),
    observedImpact: z.string(),
    learnings: z.string().optional(),
    followUpProblemIds: z.array(z.union([z.string(), z.number()])).optional(),
  }),
});
/**
 * Correcting a Problem (ADR-0017). `.strict()` for the same reason
 * `ADD_ATTEMPT` is: a stripped-away `content` would let a caller believe an
 * Observation's field had been written onto a Problem. Both fields are
 * optional and naming neither is refused by the transition, which is where the
 * "changes nothing" case is judged too.
 */
export const ReviseProblemAction = z.object({
  kind: z.literal("REVISE_PROBLEM"),
  payload: z
    .object({
      id: z.union([z.string(), z.number()]),
      title: z.string().optional(),
      description: z.string().optional(),
      reason: z.string().optional(),
    })
    .strict(),
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
/**
 * Correcting an Observation (ADR-0017). This replaces `RENAME_OBSERVATION`,
 * which overwrote `content` with no history and no reason and was reachable
 * from no surface at all — the exact shape being replaced, so it is deleted
 * rather than exposed.
 */
export const ReviseObservationAction = z.object({
  kind: z.literal("REVISE_OBSERVATION"),
  payload: z
    .object({
      id: z.string(),
      content: z.string(),
      reason: z.string().optional(),
    })
    .strict(),
});
/**
 * Correcting an Attempt (ADR-0017). `status` is absent by decision: a
 * correction is not a transition, and closing is the only thing that may move
 * one. Every field is optional and the transition judges the "names nothing"
 * and "changes nothing" cases.
 */
export const ReviseAttemptAction = z.object({
  kind: z.literal("REVISE_ATTEMPT"),
  payload: z
    .object({
      id: z.string(),
      ref: z.string().optional(),
      label: z.string().optional(),
      closingNote: z.string().optional(),
      reason: z.string().optional(),
    })
    .strict(),
});

export const MutationActionSchema = z.discriminatedUnion("kind", [
  AddProblemAction,
  ScheduleProblemAction,
  UnscheduleProblemAction,
  AbandonProblemAction,
  AddAttemptAction,
  CloseAttemptAction,
  CompleteProblemAction,
  ReviseProblemAction,
  AddObservationAction,
  ArchiveObservationAction,
  AddEvidenceAction,
  AddWorkstreamAction,
  RenameWorkstreamAction,
  ReviseObservationAction,
  ReviseAttemptAction,
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
  "ABANDON_PROBLEM",
  "ADD_ATTEMPT",
  "CLOSE_ATTEMPT",
  "COMPLETE_PROBLEM",
  "REVISE_PROBLEM",
  "ADD_OBSERVATION",
  "ARCHIVE_OBSERVATION",
  "ADD_EVIDENCE",
  "ADD_WORKSTREAM",
  "RENAME_WORKSTREAM",
  "REVISE_OBSERVATION",
  "REVISE_ATTEMPT",
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
export type AbandonProblemPayload = z.infer<typeof AbandonProblemAction>["payload"];
export type AddAttemptPayload = z.infer<typeof AddAttemptAction>["payload"];
export type CloseAttemptPayload = z.infer<typeof CloseAttemptAction>["payload"];
export type CompleteProblemPayload = z.infer<typeof CompleteProblemAction>["payload"];
export type ReviseProblemPayload = z.infer<typeof ReviseProblemAction>["payload"];
export type ReviseObservationPayload = z.infer<typeof ReviseObservationAction>["payload"];
export type ReviseAttemptPayload = z.infer<typeof ReviseAttemptAction>["payload"];
export type AddEvidencePayload = z.infer<typeof AddEvidenceAction>["payload"];
export type AddWorkstreamPayload = z.infer<typeof AddWorkstreamAction>["payload"];
export type RenameWorkstreamPayload = z.infer<typeof RenameWorkstreamAction>["payload"];
export type SelectWorkstreamPayload = z.infer<typeof SelectWorkstreamAction>["payload"];

export type MutationPayload<K extends MutationActionKind> = Extract<
  MutationAction,
  { kind: K }
>["payload"];
