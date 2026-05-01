import Link from "next/link";
import { notFound } from "next/navigation";
import { getUnlinkedObservations, getWorkstreamBySlug } from "@/lib/queries";
import { PageShell, Section } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { ArchiveToggle } from "@/components/archive-toggle";
import { SyncViewState } from "@/components/sync-view-state";
import { MutationToolbar } from "@/components/mutation-toolbar";

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

export default async function IntakePage({
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
  const obs = await getUnlinkedObservations(ws.id, showArchived);

  return (
    <>
      <SyncViewState workstreamSlug={slug} queue="intake" />
      <PageShell
        breadcrumbs={[
          { href: "/", label: "Workstreams" },
          { href: `/w/${ws.slug}`, label: ws.slug },
          { label: "intake" },
        ]}
        title="Unlinked intake"
        subtitle="Observations not yet cited by any problem as evidence."
        actions={
          <div className="flex flex-col items-end gap-2">
            <ArchiveToggle basePath={`/w/${ws.slug}/queues/intake`} showArchived={showArchived} />
            <MutationToolbar view="intake_queue" context={{ workstreamSlug: slug }} />
          </div>
        }
      >
        <Section title={`${obs.length} observation${obs.length === 1 ? "" : "s"}`}>
          {obs.length === 0 ? (
            <EmptyState>
              {showArchived
                ? "No unlinked observations, archived or otherwise."
                : "No unlinked observations. (Toggle to include archived.)"}
            </EmptyState>
          ) : (
            <ul className="space-y-2">
              {obs.map((o) => {
                const tags = parseTags(o.tags);
                return (
                  <li key={o.id}>
                    <Link href={`/w/${ws.slug}/observations/${o.id}`} className="block">
                      <Card className="hover:border-primary/40 transition-colors">
                        <CardContent className="p-4 space-y-2">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-mono text-muted-foreground">{o.id}</span>
                            {o.archive ? <Badge variant="archived">archived</Badge> : null}
                            {o.sourceType ? (
                              <span className="text-muted-foreground">{o.sourceType}</span>
                            ) : null}
                          </div>
                          <p className="text-sm whitespace-pre-wrap line-clamp-3">{o.content}</p>
                          {tags.length > 0 ? (
                            <div className="flex flex-wrap gap-1 text-xs">
                              {tags.map((t) => (
                                <span key={t} className="rounded bg-muted px-1.5 py-0.5 font-mono">
                                  {t}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          {o.archive ? (
                            <p className="text-xs text-muted-foreground">
                              archive rationale: {o.archive.rationale ?? "(none)"}
                            </p>
                          ) : null}
                        </CardContent>
                      </Card>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </PageShell>
    </>
  );
}
