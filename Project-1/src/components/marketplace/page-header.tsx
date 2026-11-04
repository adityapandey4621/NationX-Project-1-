import Link from "next/link";
import { ChevronRight } from "lucide-react";

/** Title band for listing pages: breadcrumb, heading, optional description and extra content (e.g. category rail). */
export function PageHeader({
  title,
  description,
  trail = [],
  icon,
  children,
}: {
  title: string;
  description?: string | undefined;
  /** Ancestors between Home and this page. */
  trail?: { label: string; href: string }[];
  icon?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-b bg-brand-soft">
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-6 sm:py-8">
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            {[{ label: "Home", href: "/" }, ...trail].map((c) => (
              <li key={c.href} className="flex items-center gap-1">
                <Link href={c.href} className="rounded underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                  {c.label}
                </Link>
                <ChevronRight aria-hidden className="size-3.5" />
              </li>
            ))}
            <li aria-current="page" className="font-medium text-foreground">
              {title}
            </li>
          </ol>
        </nav>
        <div className="flex items-center gap-4">
          {icon}
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">{title}</h1>
            {description ? <p className="mt-1 max-w-2xl text-foreground/75">{description}</p> : null}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
