import { cn } from "@/lib/utils";
import { HMF_STATUS_LABELS, type HelpRequestStatus } from "@/lib/help-request-labels";

const TONES: Record<HelpRequestStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  under_review: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  matched: "bg-green-500/15 text-green-700 dark:text-green-300",
  unresolved: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  cancelled: "bg-muted text-muted-foreground",
};

const EXPLANATION: Record<HelpRequestStatus, string> = {
  pending: "We've received your request and will start looking soon.",
  under_review: "Our team is looking for a local shop that can help.",
  matched: "A shop has been confirmed for this request.",
  unresolved: "We couldn't find a local source this time.",
  cancelled: "This request was cancelled.",
};

/** Human-readable status. "Shop found" is shown only when staff confirmed a real shop. */
export function StatusLine({ status }: { status: HelpRequestStatus }) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm">
      <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", TONES[status])}>{HMF_STATUS_LABELS[status]}</span>
      <span className="text-muted-foreground">{EXPLANATION[status]}</span>
    </p>
  );
}
