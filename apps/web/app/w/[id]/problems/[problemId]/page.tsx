import Link from "next/link";
import { notFound } from "next/navigation";
import { getProblemById, getWorkstreamById } from "@/lib/queries";
import { PageShell, Section } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, roadmapStatusVariant, statusVariant } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { SyncViewState } from "@/components/sync-view-state";
import { ProblemActions } from "@/components/problem-actions";

export const dynamic = "force-dynamic";

export default async function ProblemPage({
  params,
}: {
  params: Promise<{ id: string; problemId: string }>;
}) {
  const { id, problemId } = await params;
  const ws = await getWorkstreamById(id);
  if (!ws) notFound();
  const detail = await getProblemById(ws.id, parseInt(problemId, 10));
  if (!detail) notFound();
  const { problem, evidence, solutions, decisions, eliminations, abandonment, outcomes } = detail;

  return (
    <>
      <SyncViewState workstreamId={ws.id} problemId={String(problem.id)} />
      <PageShell
        breadcrumbs={[
          { href: "/", label: "Workstreams" },
          { href: `/w/${ws.id}`, label: ws.slug },
          { label: problem.title },
        ]}
        breadcrumbActions={
          <Badge variant={roadmapStatusVariant(problem.status)}>
            {problem.status ?? "unscheduled"}
          </Badge>
        }
        title={problem.title}
        actions={
          <ProblemActions
            wsId={ws.id}
            problemId={problem.id}
            status={problem.status}
            solutions={solutions.map((s) => ({ id: s.id, title: s.title, status: s.status }))}
          />
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
                              href={`/w/${ws.id}/observations/${obs.id}`}
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
                  <Link href={`/w/${ws.id}/solutions/${s.id}`} className="block">
                    <Card className="hover:border-primary/40 transition-colors">
                      <CardContent className="p-4 space-y-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <Badge variant={statusVariant(s.status)}>{s.status}</Badge>
                          <span className="font-mono text-muted-foreground">{s.id}</span>
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

        <Section title={`Decisions (${decisions.length})`}>
          {decisions.length === 0 ? (
            <EmptyState>No decision recorded yet.</EmptyState>
          ) : (
            <ul className="space-y-3">
              {decisions.map((dec) => (
                <li key={dec.id}>
                  <Card>
                    <CardContent className="p-5 space-y-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-mono text-muted-foreground">{dec.id}</span>
                        <Badge variant="chosen">chose {dec.chosenSolutionId}</Badge>
                        {dec.rejectedSolutionIds.map((sid) => (
                          <Badge key={sid} variant="rejected">
                            rejected {sid}
                          </Badge>
                        ))}
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Rationale
                        </div>
                        <p className="text-sm whitespace-pre-wrap mt-1">{dec.rationale}</p>
                      </div>
                      {dec.context ? (
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Context
                          </div>
                          <p className="text-sm whitespace-pre-wrap mt-1">{dec.context}</p>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
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
                        {e.eliminatedSolutionIds.map((sid) => (
                          <Badge key={sid} variant="rejected">
                            ruled out {sid}
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
                        <Badge variant="shipped">shipped: {o.solutionId}</Badge>
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
