import Link from "next/link";
import { ArrowRight, Sprout, Store } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { shopsLabel, summarizeCommunity } from "@/lib/marketplace/community";
import type { CommunityStat } from "@/server/validation";

/**
 * "What's happening near you", built only from real counts of live shops. Nothing here
 * is a projection: if no shop has joined recently the "new" line is simply absent, and
 * an area with no shops is shown as an invitation, never as activity.
 */
export function CommunityPulse({ stats, placeLabel, waitlistLabel }: { stats: CommunityStat[]; placeLabel: string; waitlistLabel: string }) {
  const s = summarizeCommunity(stats);

  if (s.totalShops === 0) {
    return (
      <section aria-labelledby="pulse-h" className="rounded-3xl border bg-card p-6 shadow-card sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-xl space-y-2">
            <p className="inline-flex items-center gap-2 text-xs font-semibold tracking-wider text-primary uppercase">
              <Sprout aria-hidden className="size-4" /> Just getting started
            </p>
            <h2 id="pulse-h" className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">
              Be one of the first shops on NationX in {placeLabel}.
            </h2>
            <p className="text-muted-foreground">
              We&apos;re opening {placeLabel} one shop at a time, and each one is checked by our team before it goes live. Early shops are easiest to find.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/waitlist" className={buttonVariants({ variant: "outline", size: "lg" })}>
              {waitlistLabel}
            </Link>
            <Link href="/sell" className={buttonVariants({ size: "lg" })}>
              See how it works <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="pulse-h" className="rounded-3xl border bg-card p-6 shadow-card sm:p-8">
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr] lg:items-center">
        <div className="space-y-2">
          <p className="inline-flex items-center gap-2 text-xs font-semibold tracking-wider text-primary uppercase">
            <Store aria-hidden className="size-4" /> In {placeLabel} right now
          </p>
          <h2 id="pulse-h" className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">
            {shopsLabel(s.totalShops)} live{s.joined30d > 0 ? <>, {s.joined30d} joined in the last 30 days</> : null}.
          </h2>
          <p className="text-sm text-muted-foreground">Counts are of shops our team has verified and published. Updated whenever you load this page.</p>
        </div>
        <div className="space-y-3">
          {s.recentAreas.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label="Areas with new shops">
              {s.recentAreas.slice(0, 6).map((a) => (
                <li key={a.slug}>
                  <Link
                    href={`/locality/${a.slug}`}
                    className="inline-flex h-9 items-center gap-2 rounded-full bg-success-soft px-3.5 text-sm font-medium text-success focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    <span aria-hidden className="size-1.5 rounded-full bg-success" /> {a.joined} new in {a.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          {s.emptyAreas.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              No shops listed yet in {s.emptyAreas.slice(0, 3).map((a) => a.name).join(", ")}
              {s.emptyAreas.length > 3 ? ` and ${s.emptyAreas.length - 3} more` : ""}.{" "}
              <Link href="/sell" className="font-medium text-primary underline underline-offset-4">
                Know a shop there? Invite them.
              </Link>
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}