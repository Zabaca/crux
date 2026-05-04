import Link from "next/link";
import { notFound } from "next/navigation";
import { getWorkstreamBySlug, getWorkstreamProblems } from "@/lib/queries";
import { PageShell, Section } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, roadmapStatusVariant } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { SyncViewState } from "@/components/sync-view-state";
import { MutationToolbar } from "@/components/mutation-toolbar";
import { RoadmapBoard } from "@/components/roadmap-board";

export const dynamic = "force-dynamic";

export default async function WorkstreamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ws = await getWorkstreamBySlug(slug);
  if (!ws) notFound();
  const allProblems = await getWorkstreamProblems(ws.id);

  const now = allProblems.filter((p) => p.status === "now");
  const next = allProblems.filter((p) => p.status === "next");
  const later = allProblems.filter((p) => p.status === "later");
  const unscheduled = allProblems.filter((p) => p.status == null);
  const done = allProblems.filter((p) => p.status === "done");
  const abandoned = allProblems.filter((p) => p.status === "abandoned");
  const archived = [...done, ...abandoned];

  return (
    <>
      <SyncViewState workstreamSlug={slug} />
      <PageShell
        breadcrumbs={[{ href: "/", label: "Workstreams" }, { label: ws.slug }]}
        title={ws.title}
        subtitle={ws.description ?? undefined}
        actions={
          <div className="flex flex-col items-end gap-2 text-xs text-muted-foreground">
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
            <MutationToolbar view="workstream_dashboard" context={{ workstreamSlug: ws.slug }} />
          </div>
        }
      >
        <Section title="Roadmap">
          {allProblems.length === 0 ? (
            <EmptyState>No problems yet.</EmptyState>
          ) : (
            <RoadmapBoard workstreamSlug={ws.slug} columns={{ now, next, later, unscheduled }} />
          )}
        </Section>

        {archived.length > 0 ? (
          <Section title={`Archived (${archived.length})`}>
            <details>
              <summary className="cursor-pointer text-sm text-muted-foreground select-none">
                Show {done.length} done · {abandoned.length} abandoned
              </summary>
              <ul className="space-y-2 mt-3">
                {archived.map((p) => (
                  <li key={p.id}>
                    <Link href={`/w/${ws.slug}/problems/${p.slug}`} className="block">
                      <Card className="hover:border-primary/40 transition-colors">
                        <CardContent className="flex items-start justify-between gap-4 p-4">
                          <div className="space-y-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <Badge variant={roadmapStatusVariant(p.status)}>{p.status}</Badge>
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
            </details>
          </Section>
        ) : null}
      </PageShell>
    </>
  );
}
