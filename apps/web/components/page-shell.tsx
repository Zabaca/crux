import Link from "next/link";
import { cn } from "@/lib/utils";

export function PageShell({
  breadcrumbs,
  title,
  subtitle,
  children,
  actions,
}: {
  breadcrumbs?: Array<{ href?: string; label: string }>;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="container py-6 space-y-6">
      <header className="space-y-2">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <nav className="text-xs text-muted-foreground">
            {breadcrumbs.map((b, i) => (
              <span key={i}>
                {i > 0 && <span className="px-1">/</span>}
                {b.href ? (
                  <Link href={b.href} className="hover:underline">
                    {b.label}
                  </Link>
                ) : (
                  <span>{b.label}</span>
                )}
              </span>
            ))}
          </nav>
        ) : null}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {subtitle ? <p className="text-sm text-muted-foreground mt-1">{subtitle}</p> : null}
          </div>
          {actions ? <div>{actions}</div> : null}
        </div>
      </header>
      <main className="space-y-6">{children}</main>
    </div>
  );
}

export function Section({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
