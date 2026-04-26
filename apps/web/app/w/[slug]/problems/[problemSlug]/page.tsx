import Link from "next/link";
import { notFound } from "next/navigation";
import { getProblemBySlug, getWorkstreamBySlug } from "@/lib/queries";
import { PageShell, Section } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, priorityVariant, statusVariant } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { SyncViewState } from "@/components/sync-view-state";

export const dynamic = "force-dynamic";

export default async function ProblemPage({
  params,
}: {
  params: Promise<{ slug: string; problemSlug: string }>;
}) {
  const { slug, problemSlug } = await params;
  const ws = await getWorkstreamBySlug(slug);
  if (!ws) notFound();
  const detail = await getProblemBySlug(ws.id, problemSlug);
  if (!detail) notFound();
  const { problem, evidence, solutions, latestDecision, eliminations, abandonment, outcomes } =
    detail;

  return (
    <>
      <SyncViewState workstreamSlug={slug} problemSlug={problemSlug} />
      <PageShell
        breadcrumbs={[
          { href: "/", label: "Workstreams" },
          { href: `/w/${ws.slug}`, label: ws.slug },
          { label: problem.slug },
        ]}
        title={problem.title}
        subtitle={problem.slug}
        actions={
          <div className="flex items-center gap-2">
            {problem.priorityTier ? (
              <Badge variant={priorityVariant(problem.priorityTier)}>{problem.priorityTier}</Badge>
            ) : null}
            <Badge variant={statusVariant(problem.lifecycleStatus)}>
              {problem.lifecycleStatus}
            </Badge>
          </div>
        }
      >
        <Section title="Description">
          <Card>
            <CardContent className="p-5">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{problem.description}</p>
            </CardContent>
          </Card>
        </Section>

        <Section title={`Evidence (${evidence.length})`}>
          {evidence.length === 0 ? (
            <EmptyState>No evidence yet.</EmptyState>
          ) : (
            <ul className="space-y-3">
              {evidence.map((e) => {
                const obs = e.observation;
                return (
                  <li key={e.id}>
                    <Card>
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-mono text-muted-foreground">{e.id}</span>
                          {obs ? (
                            <Link
                              href={`/w/${ws.slug}/observations/${obs.id}`}
                              className="font-mono text-muted-foreground hover:underline"
                            >
                              {obs.id}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">(observation missing)</span>
                          )}
                          {obs?.archive ? <Badge variant="archived">archived</Badge> : null}
                        </div>
                        {obs ? <p className="text-sm whitespace-pre-wrap">{obs.content}</p> : null}
                        {obs?.source ? (
                          <p className="text-xs text-muted-foreground">
                            source: {obs.source}
                            {obs.sourceType ? ` · ${obs.sourceType}` : ""}
                          </p>
                        ) : null}
                        {obs?.archive ? (
                          <p className="text-xs text-muted-foreground">
                            archive rationale: {obs.archive.rationale ?? "(none)"}
                          </p>
                        ) : null}
                        {e.note ? (
                          <p className="text-xs text-muted-foreground border-l-2 border-muted pl-2 italic">
                            why-note: {e.note}
                          </p>
                        ) : null}
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title={`Solutions (${solutions.length})`}>
          {solutions.length === 0 ? (
            <EmptyState>No solutions yet.</EmptyState>
          ) : (
            <ul className="space-y-2">
              {solutions.map((s) => (
                <li key={s.id}>
                  <Link href={`/w/${ws.slug}/solutions/${s.slug}`} className="block">
                    <Card className="hover:border-primary/40 transition-colors">
                      <CardContent className="p-4 space-y-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <Badge variant={statusVariant(s.status)}>{s.status}</Badge>
                          <span className="font-mono text-muted-foreground">{s.slug}</span>
                          {s.effort ? (
                            <span className="text-muted-foreground">effort: {s.effort}</span>
                          ) : null}
                        </div>
                        <div className="font-medium">{s.title}</div>
                        {s.description ? (
                          <p className="text-sm text-muted-foreground line-clamp-3">
                            {s.description}
                          </p>
                        ) : null}
                        {s.outcome ? (
                          <p className="text-xs text-muted-foreground">
                            outcome: {s.outcome.observedImpact.slice(0, 120)}
                            {s.outcome.observedImpact.length > 120 ? "…" : ""}
                          </p>
                        ) : null}
                      </CardContent>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Latest decision">
          {latestDecision ? (
            <Card>
              <CardContent className="p-5 space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-mono text-muted-foreground">{latestDecision.id}</span>
                  <Badge variant="chosen">chose {latestDecision.chosenSolutionSlug ?? "?"}</Badge>
                  {latestDecision.rejectedSolutionSlugs.map((slug) => (
                    <Badge key={slug} variant="rejected">
                      rejected {slug}
                    </Badge>
                  ))}
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Rationale
                  </div>
                  <p className="text-sm whitespace-pre-wrap mt-1">{latestDecision.rationale}</p>
                </div>
                {latestDecision.context ? (
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Context
                    </div>
                    <p className="text-sm whitespace-pre-wrap mt-1">{latestDecision.context}</p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : (
            <EmptyState>No decision recorded yet.</EmptyState>
          )}
        </Section>

        <Section title={`Eliminations (${eliminations.length})`}>
          {eliminations.length === 0 ? (
            <EmptyState>No eliminations.</EmptyState>
          ) : (
            <ul className="space-y-2">
              {eliminations.map((e) => (
                <li key={e.id}>
                  <Card>
                    <CardContent className="p-4 space-y-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-mono text-muted-foreground">{e.id}</span>
                        {e.eliminatedSolutionSlugs.map((slug) => (
                          <Badge key={slug} variant="rejected">
                            ruled out {slug}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{e.rationale}</p>
                      {e.context ? (
                        <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                          context: {e.context}
                        </p>
                      ) : null}
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Abandonment">
          {abandonment ? (
            <Card>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-muted-foreground">{abandonment.id}</span>
                  <Badge variant="abandoned">abandoned</Badge>
                </div>
                <p className="text-sm whitespace-pre-wrap">{abandonment.rationale}</p>
              </CardContent>
            </Card>
          ) : (
            <EmptyState>Not abandoned.</EmptyState>
          )}
        </Section>

        <Section title={`Outcomes (${outcomes.length})`}>
          {outcomes.length === 0 ? (
            <EmptyState>No outcomes recorded.</EmptyState>
          ) : (
            <ul className="space-y-2">
              {outcomes.map((o) => (
                <li key={o.id}>
                  <Card>
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-mono text-muted-foreground">{o.id}</span>
                        <Badge variant="shipped">shipped: {o.solutionSlug}</Badge>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Observed impact
                        </div>
                        <p className="text-sm whitespace-pre-wrap mt-1">{o.observedImpact}</p>
                      </div>
                      {o.expectedImpact ? (
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Expected impact
                          </div>
                          <p className="text-sm whitespace-pre-wrap mt-1">{o.expectedImpact}</p>
                        </div>
                      ) : null}
                      {o.learnings ? (
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Learnings
                          </div>
                          <p className="text-sm whitespace-pre-wrap mt-1">{o.learnings}</p>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </PageShell>
    </>
  );
}
