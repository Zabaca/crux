import Link from "next/link";
import { listWorkstreams } from "@/lib/queries";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { SyncViewState } from "@/components/sync-view-state";

export const dynamic = "force-dynamic";

export default async function Home() {
  const wss = await listWorkstreams();
  return (
    <>
      <SyncViewState workstreamId={null} />
      <PageShell title="Workstreams" subtitle="All Crux workstreams in this database.">
        {wss.length === 0 ? (
          <EmptyState>
            No workstreams. Run <code>bun run seed</code> to seed WS-crux.
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {wss.map(({ workstream: ws, tierCounts }) => (
              <li key={ws.id}>
                <Link href={`/w/${ws.id}`} className="block">
                  <Card className="hover:border-primary/40 transition-colors">
                    <CardContent className="p-5">
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
                        {(tierCounts.now > 0 ||
                          tierCounts.next > 0 ||
                          tierCounts.later > 0 ||
                          tierCounts.unscheduled > 0) && (
                          <div className="flex gap-3 text-xs text-muted-foreground pt-1">
                            {tierCounts.now > 0 && (
                              <span>
                                <span className="font-mono text-foreground">{tierCounts.now}</span>{" "}
                                now
                              </span>
                            )}
                            {tierCounts.next > 0 && (
                              <span>
                                <span className="font-mono text-foreground">{tierCounts.next}</span>{" "}
                                next
                              </span>
                            )}
                            {tierCounts.later > 0 && (
                              <span>
                                <span className="font-mono text-foreground">
                                  {tierCounts.later}
                                </span>{" "}
                                later
                              </span>
                            )}
                            {tierCounts.unscheduled > 0 && (
                              <span>
                                <span className="font-mono">{tierCounts.unscheduled}</span>{" "}
                                unscheduled
                              </span>
                            )}
                          </div>
                        )}
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
