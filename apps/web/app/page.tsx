import Link from "next/link";
import { listWorkstreams } from "@/lib/queries";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { SyncViewState } from "@/components/sync-view-state";
import { MutationToolbar } from "@/components/mutation-toolbar";

export const dynamic = "force-dynamic";

export default async function Home() {
  const wss = await listWorkstreams();
  return (
    <>
      <SyncViewState workstreamSlug={null} />
      <PageShell
        title="Workstreams"
        subtitle="All Crux workstreams in this database."
        actions={<MutationToolbar view="workstream_list" />}
      >
        {wss.length === 0 ? (
          <EmptyState>
            No workstreams. Run <code>bun run seed</code> to seed WS-crux.
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {wss.map(({ workstream: ws, openProblemCount, totalProblemCount }) => (
              <li key={ws.id}>
                <Link href={`/w/${ws.slug}`} className="block">
                  <Card className="hover:border-primary/40 transition-colors">
                    <CardContent className="flex items-start justify-between gap-4 p-5">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">{ws.slug}</span>
                          {ws.archivedAt ? <Badge variant="archived">archived</Badge> : null}
                        </div>
                        <div className="font-semibold">{ws.title}</div>
                        {ws.description ? (
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {ws.description}
                          </p>
                        ) : null}
                      </div>
                      <div className="text-right text-xs text-muted-foreground space-y-1">
                        <div>
                          <span className="text-foreground font-mono text-base">
                            {openProblemCount}
                          </span>{" "}
                          open
                        </div>
                        <div>{totalProblemCount} total</div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PageShell>
    </>
  );
}
