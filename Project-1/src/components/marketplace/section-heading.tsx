import Link from "next/link";
import { ArrowRight } from "lucide-react";

/** Section title with an optional "see all" link. Pass `id` and reference it from the section's aria-labelledby. */
export function SectionHeading({
  id,
  title,
  kicker,
  href,
  hrefLabel = "See all",
}: {
  id: string;
  title: string;
  kicker?: string | undefined;
  href?: string | undefined;
  hrefLabel?: string | undefined;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="min-w-0">
        {kicker ? <p className="text-xs font-semibold tracking-wider text-primary uppercase">{kicker}</p> : null}
        <h2 id={id} className="text-xl font-semibold tracking-tight sm:text-2xl">
          {title}
        </h2>
      </div>
      {href ? (
        <Link href={href} className="inline-flex shrink-0 items-center gap-1 rounded-lg py-2 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
          {hrefLabel}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}
