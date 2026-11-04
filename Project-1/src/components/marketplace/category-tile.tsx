import Link from "next/link";
import { CategoryIcon } from "@/components/marketplace/category-icon";
import type { TemplateKey } from "@/lib/marketplace/presentation";
import { cn } from "@/lib/utils";

interface CategoryTileProps {
  name: string;
  slug: string;
  href: string;
  /** Shown only when known; omitted when the page is scoped to one area. */
  shopCount?: number | undefined;
  template?: TemplateKey | undefined;
  /** "rail" tiles are fixed-width and scroll horizontally on phones. */
  layout?: "rail" | "grid";
  active?: boolean;
}

export function CategoryTile({ name, slug, href, shopCount, template, layout = "grid", active }: CategoryTileProps) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-2xl border bg-card p-3 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-lift focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        layout === "rail" ? "w-44 shrink-0 snap-start sm:w-auto" : "min-w-0",
        active && "border-primary ring-2 ring-primary/30",
      )}
    >
      <CategoryIcon slug={slug} template={template} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold leading-tight">{name}</span>
        {shopCount !== undefined ? (
          <span className="block text-xs text-muted-foreground">
            {shopCount} {shopCount === 1 ? "store" : "stores"}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
