import { getOpenStatus, type OperatingHoursLike } from "@/lib/opening-hours";
import { cn } from "@/lib/utils";

/**
 * Open / closed pill computed (in IST) from the hours the shop itself recorded.
 * It is not a live confirmation, so the tooltip and screen-reader text say so.
 */
export function OpenStatus({ hours, className }: { hours: OperatingHoursLike | null; className?: string }) {
  if (!hours) return null;
  const open = getOpenStatus(hours) === "open";
  return (
    <span
      title="Based on the hours entered by the shop"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        open ? "bg-success-soft text-success" : "bg-muted text-muted-foreground",
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", open ? "bg-success" : "bg-muted-foreground/60")} />
      {open ? "Open now" : "Closed now"}
      <span className="sr-only"> (per the shop&apos;s own hours)</span>
    </span>
  );
}
