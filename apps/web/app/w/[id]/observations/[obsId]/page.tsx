import Link from "next/link";
import { notFound } from "next/navigation";
import { getObservationById } from "@/lib/queries";
import { PageShell, Section } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, roadmapStatusVariant } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";

export const dynamic = "force-dynamic";

function parseTags(tags: string | null): string[] {
  if (!tags) return [];
  try {
    const v = JSON.parse(tags);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export default async function ObservationPage({
  params,
}: {
  params: Promise<{ id: string; obsId: string }>;
}) {
  const { id, obsId } = await params;
  const detail = await getObservationById(id, obsId);
  if (!detail) notFound();
  const { observation, workstream, linkedProblems } = detail;
  const tags = parseTags(observation.tags);

  return (
    <PageShell
      breadcrumbs={[
        { href: "/", label: "Workstreams" },
        { href: `/w/${workstream.id}`, label: workstream.slug },
        { label: observation.id },
      ]}
      title={observation.id}
      subtitle="Observation"
      actions={observation.archive ? <Badge variant="archived">archived</Badge> : null}
    >
      <Section title="Content">
        <Card>
          <CardContent className="p-5 space-y-3">
            <p className="text-sm whitespace-pre-wrap leading-relaxed">{observation.content}</p>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              {observation.source ? <span>source: {observation.source}</span> : null}
              {observation.sourceType ? <span>type: {observation.sourceType}</span> : null}
              {tags.length > 0 ? (
                <span>
                  tags:{" "}
                  {tags.map((t) => (
                    <span key={t} className="ml-1 rounded bg-muted px-1.5 py-0.5 font-mono">
                      {t}
                    </span>
                  ))}
                </span>
              ) : null}
            </div>
            {observation.archive ? (
              <p className="text-xs text-muted-foreground">
                archive rationale: {observation.archive.rationale ?? "(none)"}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </Section>

      <Section title={`Linked problems (${linkedProblems.length})`}>
        {linkedProblems.length === 0 ? (
          <EmptyState>Unlinked — no problem cites this observation.</EmptyState>
        ) : (
          <ul className="space-y-2">
            {linkedProblems.map(({ evidence: ev, problem }) =>
              problem ? (
                <li key={ev.id}>
                  <Link href={`/w/${workstream.id}/problems/${problem.id}`} className="block">
                    <Card className="hover:border-primary/40 transition-colors">
                      <CardContent className="p-4 space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <Badge variant={roadmapStatusVariant(problem.status)}>
                            {problem.status ?? "unscheduled"}
                          </Badge>
                          <span className="font-mono text-muted-foreground">{problem.id}</span>
                          <span className="font-mono text-muted-foreground">via {ev.id}</span>
                        </div>
                        <div className="font-medium">{problem.title}</div>
                        {ev.note ? (
                          <p className="text-xs text-muted-foreground italic border-l-2 border-muted pl-2">
                            why-note: {ev.note}
                          </p>
                        ) : null}
                      </CardContent>
                    </Card>
                  </Link>
                </li>
              ) : null,
            )}
          </ul>
        )}
      </Section>
    </PageShell>
  );
}
