import { formatPrice } from "@/lib/stock";

/** Price with an optional struck-through MRP. A missing price reads "Call for price", never a guess. */
export function Price({ price, mrp, unit }: { price: number | null; mrp: number | null; unit: string | null }) {
  return (
    <p className="text-sm">
      <span className="font-medium">{formatPrice(price)}</span>
      {price !== null && unit ? <span className="text-muted-foreground"> / {unit}</span> : null}
      {price !== null && mrp !== null && mrp > price ? (
        <span className="ml-2 text-xs text-muted-foreground line-through">
          <span className="sr-only">MRP </span>
          {formatPrice(mrp)}
        </span>
      ) : null}
    </p>
  );
}
