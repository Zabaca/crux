import { z } from "zod";

const slug = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be kebab-case lowercase");

export const WorkstreamInput = z.object({
  slug,
  title: z.string().min(1),
  description: z.string().optional(),
});

export const SourceType = z.enum([
  "internal",
  "competitive",
  "external",
  "analysis",
  "customer_report",
  "metric_signal",
]);

export const ObservationInput = z.object({
  workstream: z.string().min(1), // full workstream ID like "WS-crux" or slug like "crux"
  content: z.string().min(1),
  source: z.string().optional(),
  sourceType: SourceType.optional(),
  tags: z.array(z.string()).optional(),
});

export const ProblemInput = z.object({
  workstream: z.string().min(1), // full workstream ID like "WS-crux"
  title: z.string().min(1),
  description: z.string().min(1),
});

export const RoadmapTier = z.enum(["now", "next", "later"]);

export const EvidenceInput = z.object({
  observationId: z.string().min(1),
  problemId: z.union([z.string().min(1), z.number()]),
  note: z.string().optional(),
});

export const SolutionInput = z.object({
  problemId: z.union([z.string().min(1), z.number()]), // integer problem ID
  title: z.string().min(1),
  description: z.string().optional(),
});

export const DecisionInput = z.object({
  workstream: z.string().min(1),
  problemId: z.union([z.string().min(1), z.number()]),
  chosen: z.union([z.string().min(1), z.number()]),
  rejected: z.array(z.union([z.string(), z.number()])).default([]),
  rationale: z.string().min(1),
  context: z.string().optional(),
});

export const UserInitInput = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
});

// --- Pass 2 ---

export const EliminationInput = z.object({
  problemId: z.union([z.string().min(1), z.number()]),
  solutions: z.array(z.union([z.string(), z.number()])).min(1),
  rationale: z.string().min(1),
  context: z.string().optional(),
});

export const OutcomeInput = z.object({
  solutionId: z.union([z.string().min(1), z.number()]),
  observedImpact: z.string().min(1),
  expectedImpact: z.string().optional(),
  learnings: z.string().optional(),
  followUpProblems: z.array(z.union([z.string(), z.number()])).optional(),
});

export const ObservationArchiveInput = z.object({
  observationId: z.string().min(1),
  rationale: z.string().min(1),
});
