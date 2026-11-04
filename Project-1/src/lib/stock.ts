/** Dependency-free so client and server components can both import it. */

export type StockLabelKey = "in_stock" | "call_to_confirm" | "out_of_stock";

export const STOCK_LABELS: Record<StockLabelKey, string> = {
  in_stock: "In stock",
  call_to_confirm: "Call to confirm",
  out_of_stock: "Out of stock",
};

const rupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

/** Unknown price is never guessed (NFR-06): callers show "Call for price" for null. */
export function formatPrice(value: number | null): string {
  return value === null ? "Call for price" : rupees.format(value);
}
