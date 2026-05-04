import Link from "next/link";
import type { getWorkstreamProblems } from "@/lib/queries";
import { Card, CardContent } from "@/components/ui/card";

export type ProblemRow = Awaited<ReturnType<typeof getWorkstreamProblems>>[number];

export function ProblemCard({ slug, p }: { slug: string; p: ProblemRow }) {
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
