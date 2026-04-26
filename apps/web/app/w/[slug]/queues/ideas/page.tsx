import { notFound } from "next/navigation";
import { getUnpromotedIdeas, getWorkstreamBySlug } from "@/lib/queries";
import { PageShell, Section } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { ArchiveToggle } from "@/components/archive-toggle";
import { SyncViewState } from "@/components/sync-view-state";

export const dynamic = "force-dynamic";

export default async function IdeasPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const showArchived = sp["show-archived"] === "1";
  const ws = await getWorkstreamBySlug(slug);
  if (!ws) notFound();
  const ideas = await getUnpromotedIdeas(ws.id, showArchived);

  return (
    <>
      <SyncViewState workstreamSlug={slug} queue="ideas" />
      <PageShell
        breadcrumbs={[
          { href: "/", label: "Workstreams" },
          { href: `/w/${ws.slug}`, label: ws.slug },
          { label: "ideas" },
        ]}
        title="Unpromoted ideas"
        subtitle="Ideas not yet referenced by any solution as originating-idea."
        actions={
          <ArchiveToggle basePath={`/w/${ws.slug}/queues/ideas`} showArchived={showArchived} />
        }
      >
        <Section title={`${ideas.length} idea${ideas.length === 1 ? "" : "s"}`}>
          {ideas.length === 0 ? (
            <EmptyState>
              {showArchived
                ? "No unpromoted ideas, archived or otherwise."
                : "No unpromoted ideas. (Toggle to include archived.)"}
            </EmptyState>
          ) : (
            <ul className="space-y-2">
              {ideas.map((i) => (
                <li key={i.id}>
                  <Card>
                    <CardContent className="p-4 space-y-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-mono text-muted-foreground">{i.slug}</span>
                        {i.archive ? <Badge variant="archived">archived</Badge> : null}
                      </div>
                      <div className="font-medium">{i.title}</div>
                      {i.description ? (
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                          {i.description}
                        </p>
                      ) : null}
                      {i.hypothesizedProblemArea ? (
                        <p className="text-xs text-muted-foreground">
                          hypothesized problem area: {i.hypothesizedProblemArea}
                        </p>
                      ) : null}
                      {i.archive ? (
                        <p className="text-xs text-muted-foreground">
                          archive rationale: {i.archive.rationale ?? "(none)"}
                        </p>
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
