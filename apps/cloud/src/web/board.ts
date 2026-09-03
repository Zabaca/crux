/**
 * The board's data load: what `/w/<slug>` reads before it hands anything to a
 * React island.
 *
 * The other read surfaces live in `read-pages.ts` because they render markup on
 * the server. The board renders nothing there — it is an island (ADR-0009) — so
 * what it has is a read composition and no view, and that composition is here
 * rather than inline in the `.astro` frontmatter for one reason: frontmatter is
 * not importable, and the property worth defending is how many round trips this
 * costs. A test can hold this; it cannot hold a page.
 */
import {
  query,
  type ObservationSummary,
  type ProblemSummary,
  type ReadContext,
} from "@crux/core/reads";
import type { WorkstreamRow } from "@crux/core/reads";

export type BoardData = {
  workstream: WorkstreamRow;
  problems: ProblemSummary[];
  observations: ObservationSummary[];
};

/**
 * Everything `/w/<slug>` shows, or null when the slug names no Workstream this
 * Principal owns — which the page answers with a 404, the same way a slug that
 * never existed is answered (ADR-0013).
 *
 * Two round trips deep, not three. The summaries both want `ws.id` and neither
 * wants the other's answer, so the page waits for the slower rather than for
 * their sum. The scope comes in already resolved on `read`; resolving it per
 * query is what made rendering this page resolve the same boundary three times.
 */
export async function boardData(read: ReadContext, slug: string): Promise<BoardData | null> {
  const workstream = (await query(
    { kind: "WORKSTREAM_BY_SLUG", slug },
    read,
  )) as WorkstreamRow | null;
  if (!workstream) return null;
  const [problems, observations] = (await Promise.all([
    query({ kind: "PROBLEM_SUMMARIES", workstreamId: workstream.id }, read),
    query({ kind: "OBSERVATION_SUMMARIES", workstreamId: workstream.id }, read),
  ])) as [ProblemSummary[], ObservationSummary[]];
  return { workstream, problems, observations };
}
