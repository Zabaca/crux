import Link from "next/link";
import { notFound } from "next/navigation";
import { getSolutionBySlug } from "@/lib/queries";
import { PageShell, Section } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, roadmapStatusVariant, statusVariant } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";

export const dynamic = "force-dynamic";

export default async function SolutionPage({
  params,
}: {
  params: Promise<{ slug: string; solutionSlug: string }>;
}) {
  const { slug, solutionSlug } = await params;
  const detail = await getSolutionBySlug(slug, solutionSlug);
  if (!detail) notFound();
  const {
    solution,
    problem,
    workstream,
    choosingDecisions,
    rejectingDecisions,
    eliminations,
    outcome,
    originatingIdea,
  } = detail;

  return (
    <PageShell
      breadcrumbs={[
        { href: "/", label: "Workstreams" },
        { href: `/w/${workstream.slug}`, label: workstream.slug },
        {
          href: `/w/${workstream.slug}/problems/${problem.slug}`,
          label: problem.slug,
        },
        { label: solution.slug },
      ]}
      title={solution.title}
      subtitle={solution.slug}
      actions={
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant(solution.status)}>{solution.status}</Badge>
          {solution.effort ? (
            <span className="text-xs text-muted-foreground">effort: {solution.effort}</span>
          ) : null}
        </div>
      }
    >
      <Section title="Parent problem">
        <Link href={`/w/${workstream.slug}/problems/${problem.slug}`} className="block">
          <Card className="hover:border-primary/40 transition-colors">
            <CardContent className="p-4 space-y-1">
              <div className="flex items-center gap-2 text-xs">
                <Badge variant={roadmapStatusVariant(problem.status)}>
                  {problem.status ?? "unscheduled"}
                </Badge>
                <span className="font-mono text-muted-foreground">{problem.slug}</span>
              </div>
              <div className="font-medium">{problem.title}</div>
            </CardContent>
          </Card>
        </Link>
      </Section>

      {solution.description ? (
        <Section title="Description">
          <Card>
            <CardContent className="p-5">
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{solution.description}</p>
            </CardContent>
          </Card>
        </Section>
      ) : null}

      <Section title="Decisions touching this solution">
        {choosingDecisions.length === 0 && rejectingDecisions.length === 0 ? (
          <EmptyState>No decision references this solution.</EmptyState>
        ) : (
          <ul className="space-y-2">
            {choosingDecisions.map((d) => (
              <li key={d.id}>
                <Card>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono text-muted-foreground">{d.id}</span>
                      <Badge variant="chosen">chose this</Badge>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{d.rationale}</p>
                  </CardContent>
                </Card>
              </li>
            ))}
            {rejectingDecisions.map((d) => (
              <li key={d.id}>
                <Card>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono text-muted-foreground">{d.id}</span>
                      <Badge variant="rejected">rejected this</Badge>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{d.rationale}</p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Eliminations">
        {eliminations.length === 0 ? (
          <EmptyState>No elimination touches this solution.</EmptyState>
        ) : (
          <ul className="space-y-2">
            {eliminations.map((e) => (
              <li key={e.id}>
                <Card>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono text-muted-foreground">{e.id}</span>
                      <Badge variant="rejected">ruled out</Badge>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{e.rationale}</p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Outcome">
        {outcome ? (
          <Card>
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-mono text-muted-foreground">{outcome.id}</span>
                <Badge variant="shipped">shipped</Badge>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Observed impact
                </div>
                <p className="text-sm whitespace-pre-wrap mt-1">{outcome.observedImpact}</p>
              </div>
              {outcome.expectedImpact ? (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Expected impact
                  </div>
                  <p className="text-sm whitespace-pre-wrap mt-1">{outcome.expectedImpact}</p>
                </div>
              ) : null}
              {outcome.learnings ? (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Learnings
                  </div>
                  <p className="text-sm whitespace-pre-wrap mt-1">{outcome.learnings}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          <EmptyState>Not shipped — no outcome recorded.</EmptyState>
        )}
      </Section>

      {originatingIdea ? (
        <Section title="Originating idea">
          <Card>
            <CardContent className="p-4 space-y-1">
              <div className="text-xs font-mono text-muted-foreground">{originatingIdea.slug}</div>
              <div className="font-medium">{originatingIdea.title}</div>
              {originatingIdea.description ? (
                <p className="text-sm text-muted-foreground">{originatingIdea.description}</p>
              ) : null}
            </CardContent>
          </Card>
        </Section>
      ) : null}
    </PageShell>
  );
}
