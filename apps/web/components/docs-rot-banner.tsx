import type { DocRot } from "@crux/core/docs";

/** Structural rot, loud where docs are read and nowhere else (ADR-0002). */
export function DocsRotBanner({ rot }: { rot: DocRot }) {
  if (rot.brokenLinks.length === 0 && rot.orphans.length === 0) return null;

  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 space-y-2 text-sm">
      <div className="font-semibold">Structural rot in the doc tree</div>
      {rot.brokenLinks.length > 0 ? (
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Broken links ({rot.brokenLinks.length})
          </div>
          <ul className="space-y-0.5 font-mono text-xs">
            {rot.brokenLinks.map((link) => (
              <li key={`${link.from}:${link.raw}`}>
                {link.from} → {link.target}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {rot.orphans.length > 0 ? (
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Orphans — unreachable from README ({rot.orphans.length})
          </div>
          <ul className="space-y-0.5 font-mono text-xs">
            {rot.orphans.map((orphan) => (
              <li key={orphan}>{orphan}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
