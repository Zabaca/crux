import { z } from "zod";

const slug = z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be kebab-case lowercase");

export const WorkstreamInput = z.object({
  slug,
  title: z.string().min(1),
  description: z.string().optional(),
});

export const ObservationInput = z.object({
  workstream: slug,
  content: z.string().min(1),
  source: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const ProblemInput = z.object({
  workstream: slug,
  slug,
  title: z.string().min(1),
  description: z.string().min(1),
  priorityTier: z.enum(["P0", "P1", "P2", "P3"]).optional(),
});

export const EvidenceInput = z.object({
  observationId: z.string().min(1),
  problemSlug: slug,
  note: z.string().optional(),
});

export const SolutionInput = z.object({
  problemSlug: slug,
  slug,
  title: z.string().min(1),
  description: z.string().optional(),
});

export const DecisionInput = z.object({
  workstream: slug,
  problemSlug: slug,
  chosen: slug,
  rejected: z.array(slug).default([]),
  rationale: z.string().min(1),
  context: z.string().optional(),
});

export const UserInitInput = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
});

// --- Pass 2 ---

export const IdeaInput = z.object({
  workstream: slug,
  slug,
  title: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  hypothesizedProblemArea: z.string().optional(),
});

export const IdeaPromoteInput = z.object({
  ideaSlug: slug,
  problemSlug: slug,
  solutionSlug: slug,
  title: z.string().min(1),
  description: z.string().optional(),
  effort: z.enum(["S", "M", "L", "XL"]).optional(),
});

export const EliminationInput = z.object({
  problemSlug: slug,
  solutions: z.array(slug).min(1),
  rationale: z.string().min(1),
  context: z.string().optional(),
});

export const OutcomeInput = z.object({
  solutionSlug: slug,
  observedImpact: z.string().min(1),
  expectedImpact: z.string().optional(),
  learnings: z.string().optional(),
  followUpProblems: z.array(slug).optional(),
});

export const ThemeInput = z.object({
  workstream: slug,
  slug,
  title: z.string().min(1),
  description: z.string().optional(),
  timeframe: z.string().optional(),
});

export const ThemeAttachInput = z.object({
  themeSlug: slug,
  solutionSlug: slug,
});
