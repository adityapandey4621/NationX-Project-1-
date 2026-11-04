import { cn } from "@/lib/utils";
import { STOCK_LABELS, type StockLabelKey } from "@/lib/stock";

const STYLES: Record<StockLabelKey, string> = {
  in_stock: "bg-success-soft text-success",
  call_to_confirm: "bg-warning-soft text-amber-900 dark:text-amber-200",
  out_of_stock: "bg-muted text-muted-foreground",
};

/** Availability label. Pass the *effective* status: stale or unconfirmed stock arrives as call_to_confirm. */
export function StockBadge({ status }: { status: StockLabelKey }) {
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", STYLES[status])}>{STOCK_LABELS[status]}</span>;
}
