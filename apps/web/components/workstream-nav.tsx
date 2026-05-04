import { listWorkstreams } from "@/lib/queries";
import { WorkstreamNavShell, type WorkstreamNavItem } from "./workstream-nav-shell";

export async function WorkstreamNav() {
  const wss = await listWorkstreams();
  const items: WorkstreamNavItem[] = wss.map(
    ({ workstream, openProblemCount, totalProblemCount }) => ({
      slug: workstream.slug,
      title: workstream.title,
      archived: Boolean(workstream.archivedAt),
      openProblemCount,
      totalProblemCount,
    }),
  );
  return <WorkstreamNavShell items={items} />;
}
