import { SearchBox } from "@/components/marketplace/search-box";
import { cn } from "@/lib/utils";

/**
 * The header's compact search. It is always rendered (no pathname-dependent branch:
 * server and client disagreeing about the path caused a production hydration mismatch).
 * Pages that carry their own prominent search mark it with `data-own-search`, and the
 * `body:has(...)` rule in globals.css hides this one.
 */
export function HeaderSearch({ locality, className, placeholder, buttonLabel }: { locality?: string | undefined; className?: string; placeholder: string; buttonLabel: string }) {
  return (
    <div data-header-search className={cn(className)}>
      <SearchBox size="md" locality={locality} placeholder={placeholder} buttonLabel={buttonLabel} />
    </div>
  );
}
