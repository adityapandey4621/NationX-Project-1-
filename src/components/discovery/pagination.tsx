import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { buildListingHref, type SearchView } from "@/lib/search-url";

/** Previous / next links that keep the current filters. Renders nothing for a single page. */
export function Pagination({ basePath, view, page, pages }: { basePath: string; view: SearchView; page: number; pages: number }) {
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 pt-2">
      {page > 1 ? (
        <Link href={buildListingHref(basePath, { ...view, page: page - 1 })} rel="prev" className={buttonVariants({ variant: "outline" })}>
          ← Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-sm text-muted-foreground">
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <Link href={buildListingHref(basePath, { ...view, page: page + 1 })} rel="next" className={buttonVariants({ variant: "outline" })}>
          Next →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
