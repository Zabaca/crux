import Link from "next/link";
import { notFound } from "next/navigation";
import { getWorkstreamBySlug, getWorkstreamProblems } from "@/lib/queries";
import { PageShell, Section } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, roadmapStatusVariant } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { SyncViewState } from "@/components/sync-view-state";
import { MutationToolbar } from "@/components/mutation-toolbar";

export const dynamic = "force-dynamic";

type ProblemRow = Awaited<ReturnType<typeof getWorkstreamProblems>>[number];

function ProblemCard({ slug, p }: { slug: string; p: ProblemRow }) {
  return (
    <Link href={`/w/${slug}/problems/${p.slug}`} className="block">
      <Card className="hover:border-primary/40 transition-colors">
        <CardContent className="p-3 space-y-1.5">
          <div className="font-medium text-sm leading-snug">{p.title}</div>
          <div className="font-mono text-xs text-muted-foreground truncate">{p.slug}</div>
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span>
              <span className="font-mono text-foreground">{p.evidenceCount}</span> ev
            </span>
            <span>
              <span className="font-mono text-foreground">{p.solutionCount}</span> sol
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function Column({
  title,
  rows,
  slug,
  tone,
}: {
  title: string;
  rows: ProblemRow[];
  slug: string;
  tone?: string;
}) {
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div className="flex items-center gap-2">
        <h3 className={`text-xs font-semibold uppercase tracking-wide ${tone ?? ""}`}>{title}</h3>
        <span className="text-xs text-muted-foreground">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div className="text-xs text-muted-foreground italic">empty</div>
      ) : (
        <ul className="space-y-2">
          {rows.map((p) => (
            <li key={p.id}>
              <ProblemCard slug={slug} p={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Column title="Now" rows={now} slug={ws.slug} tone="text-red-600" />
              <Column title="Next" rows={next} slug={ws.slug} tone="text-orange-600" />
              <Column title="Later" rows={later} slug={ws.slug} tone="text-stone-600" />
              <Column title="Unscheduled" rows={unscheduled} slug={ws.slug} tone="text-slate-500" />
            </div>
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
