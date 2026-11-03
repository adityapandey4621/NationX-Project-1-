/** Customer-facing wording for Help Me Find It statuses (no dependencies: safe for client bundles). */
export type HelpRequestStatus = "pending" | "under_review" | "matched" | "unresolved" | "cancelled";

export const HMF_STATUS_LABELS: Record<HelpRequestStatus, string> = {
  pending: "Received",
  under_review: "Being looked at",
  matched: "Shop found",
  unresolved: "Couldn't find it",
  cancelled: "Cancelled",
};
