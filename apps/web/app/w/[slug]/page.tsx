import Link from "next/link";
import { notFound } from "next/navigation";
import { getWorkstreamBySlug, getWorkstreamProblems } from "@/lib/queries";
import { PageShell, Section } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, priorityVariant, statusVariant } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { SyncViewState } from "@/components/sync-view-state";

export const dynamic = "force-dynamic";

export default async function WorkstreamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ws = await getWorkstreamBySlug(slug);
  if (!ws) notFound();
  const allProblems = await getWorkstreamProblems(ws.id);
  const open = allProblems.filter(
    (p) => p.lifecycleStatus !== "shipped" && p.lifecycleStatus !== "abandoned",
  );
  const closed = allProblems.filter(
    (p) => p.lifecycleStatus === "shipped" || p.lifecycleStatus === "abandoned",
  );

  return (
    <>
      <SyncViewState workstreamSlug={slug} />
      <PageShell
        breadcrumbs={[{ href: "/", label: "Workstreams" }, { label: ws.slug }]}
        title={ws.title}
        subtitle={ws.description ?? undefined}
        actions={
          <div className="flex flex-col items-end gap-1 text-xs text-muted-foreground">
            <div className="flex gap-2">
              <Link
                href={`/w/${ws.slug}/queues/intake`}
                className="rounded border px-2 py-1 hover:bg-accent"
              >
                Intake queue
              </Link>
              <Link
                href={`/w/${ws.slug}/queues/ideas`}
                className="rounded border px-2 py-1 hover:bg-accent"
              >
                Ideas queue
              </Link>
            </div>
          </div>
        }
      >
        <Section
          title="Open problems"
          description="Sorted by priority (P0→P3, then null), then created time."
        >
          {open.length === 0 ? (
            <EmptyState>No open problems.</EmptyState>
          ) : (
            <ul className="space-y-2">
              {open.map((p) => (
                <li key={p.id}>
                  <Link href={`/w/${ws.slug}/problems/${p.slug}`} className="block">
                    <Card className="hover:border-primary/40 transition-colors">
                      <CardContent className="flex items-start justify-between gap-4 p-4">
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            {p.priorityTier ? (
                              <Badge variant={priorityVariant(p.priorityTier)}>
                                {p.priorityTier}
                              </Badge>
                            ) : (
                              <Badge variant="outline">no priority</Badge>
                            )}
                            <Badge variant={statusVariant(p.lifecycleStatus)}>
                              {p.lifecycleStatus}
                            </Badge>
                            <span className="font-mono text-muted-foreground">{p.slug}</span>
                          </div>
                          <div className="font-medium truncate">{p.title}</div>
                        </div>
                        <div className="shrink-0 text-right text-xs text-muted-foreground space-y-0.5">
                          <div>
                            <span className="font-mono text-foreground">{p.evidenceCount}</span>{" "}
                            evidence
                          </div>
                          <div>
                            <span className="font-mono text-foreground">{p.solutionCount}</span>{" "}
                            solutions
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {closed.length > 0 ? (
          <Section title="Shipped or abandoned">
            <ul className="space-y-2">
              {closed.map((p) => (
                <li key={p.id}>
                  <Link href={`/w/${ws.slug}/problems/${p.slug}`} className="block">
                    <Card className="hover:border-primary/40 transition-colors">
                      <CardContent className="flex items-start justify-between gap-4 p-4">
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            {p.priorityTier ? (
                              <Badge variant={priorityVariant(p.priorityTier)}>
                                {p.priorityTier}
                              </Badge>
                            ) : (
                              <Badge variant="outline">no priority</Badge>
                            )}
                            <Badge variant={statusVariant(p.lifecycleStatus)}>
                              {p.lifecycleStatus}
                            </Badge>
                            <span className="font-mono text-muted-foreground">{p.slug}</span>
                          </div>
                          <div className="font-medium truncate">{p.title}</div>
                        </div>
                        <div className="shrink-0 text-right text-xs text-muted-foreground space-y-0.5">
                          <div>
                            <span className="font-mono text-foreground">{p.evidenceCount}</span>{" "}
                            evidence
                          </div>
                          <div>
                            <span className="font-mono text-foreground">{p.solutionCount}</span>{" "}
                            solutions
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </PageShell>
    </>
  );
}
