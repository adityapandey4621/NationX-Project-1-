import { cn } from "@/lib/utils";
import type { ApplicationStatus } from "@/server/validation";

const LABELS: Record<ApplicationStatus, string> = {
  draft: "Draft",
  submitted: "Under review",
  correction_requested: "Corrections needed",
  approved: "Approved",
  rejected: "Rejected",
  suspended: "Suspended",
};

const TONES: Record<ApplicationStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  correction_requested: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  approved: "bg-green-500/15 text-green-700 dark:text-green-300",
  rejected: "bg-destructive/15 text-destructive",
  suspended: "bg-destructive/15 text-destructive",
};

export function applicationStatusLabel(status: ApplicationStatus): string {
  return LABELS[status];
}

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", TONES[status])}>
      {LABELS[status]}
    </span>
  );
}
