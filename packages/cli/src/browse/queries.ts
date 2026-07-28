import type { schema } from "@crux/core/db";
import { api } from "../api-client.js";

/**
 * Read-only query layer for the TUI (`crux browse`).
 *
 * Every function here is a named read resolved by the deployment — the shapes
 * are defined and tested in `@crux/core/reads`; this module is the typed calling
 * convention the views use.
 */

type Tables = typeof schema;

export type ArchiveBlock = {
  rationale: string | null;
  archivedById: string | null;
  archivedAt: number;
} | null;

export type Workstream = Tables["workstreams"]["$inferSelect"];
export type Problem = Tables["problems"]["$inferSelect"];
export type Observation = Tables["observations"]["$inferSelect"] & { archive: ArchiveBlock };
export type Solution = Tables["solutions"]["$inferSelect"];
export type Evidence = Tables["evidence"]["$inferSelect"];
export type Decision = Tables["decisions"]["$inferSelect"] & { rejectedSolutionIds: number[] };
export type Elimination = Tables["eliminations"]["$inferSelect"] & {
  eliminatedSolutionIds: number[];
};
export type Abandonment = Tables["abandonments"]["$inferSelect"];
export type Outcome = Tables["outcomes"]["$inferSelect"] & { followUpProblemIds: number[] };

export function listWorkstreams(): Promise<Array<Workstream & { openProblemCount: number }>> {
  return api().query({ kind: "WORKSTREAM_SUMMARIES" });
}

export function getWorkstreamBySlug(slug: string): Promise<Workstream | null> {
  return api().query({ kind: "WORKSTREAM_BY_SLUG", slug });
}

export function getWorkstreamById(id: string): Promise<Workstream | null> {
  return api().query({ kind: "WORKSTREAM_GET", id });
}

export type ProblemSummary = Problem & { evidenceCount: number; solutionCount: number };

export function listOpenProblems(workstreamId: string): Promise<ProblemSummary[]> {
  return api().query({ kind: "PROBLEM_SUMMARIES", workstreamId });
}

export function getProblemById(id: number): Promise<Problem | null> {
  return api().query({ kind: "PROBLEM_GET", id });
}

export type ProblemDetail = {
  problem: Problem;
  evidence: Array<Evidence & { observation: Observation | null }>;
  solutions: Array<Solution & { outcome: Outcome | null }>;
  latestDecision: Decision | null;
  eliminations: Elimination[];
  abandonment: Abandonment | null;
};

export function getProblemDetail(problemId: number): Promise<ProblemDetail | null> {
  return api().query({ kind: "PROBLEM_DETAIL", id: problemId });
}

export type SolutionDetail = {
  solution: Solution;
  problem: Problem;
  choosingDecision: Decision | null;
  rejectingDecision: Decision | null;
  eliminatedBy: Elimination[];
  outcome: Outcome | null;
};

export function getSolutionById(id: number): Promise<Solution | null> {
  return api().query({ kind: "SOLUTION_GET", id });
}

export function getSolutionDetail(solutionId: number): Promise<SolutionDetail | null> {
  return api().query({ kind: "SOLUTION_DETAIL", id: solutionId });
}

export type ObservationDetail = {
  observation: Observation;
  evidenceLinks: Array<Evidence & { problem: Problem }>;
};

export function getObservationDetail(id: string): Promise<ObservationDetail | null> {
  return api().query({ kind: "OBSERVATION_DETAIL", id });
}

export function listUnlinkedObservations(
  workstreamId: string,
  showArchived: boolean,
): Promise<Observation[]> {
  return api().query({ kind: "OBSERVATION_UNLINKED", workstreamId, showArchived });
}

export function getSolutionsByIds(ids: number[]): Promise<Solution[]> {
  return api().query({ kind: "SOLUTION_BY_IDS", ids });
}
