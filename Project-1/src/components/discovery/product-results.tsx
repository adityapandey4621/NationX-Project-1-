import { ProductCard } from "@/components/marketplace/product-card";
import type { ProductResult } from "@/server/validation";

/** Items matching the search, each linking to the selling shop. Real, published listings only. */
export function ProductResults({ results, total, q, from }: { results: ProductResult[]; total: number; q: string; from: string }) {
  if (results.length === 0) return null;
  return (
    <section aria-labelledby="items-found-h" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 id="items-found-h" className="text-lg font-semibold">
          Items for “{q}”
        </h2>
        <p className="text-sm text-muted-foreground" role="status">
          {total} {total === 1 ? "item" : "items"} listed by local shops
          {total > results.length ? ` · showing the first ${results.length}` : ""}
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {results.map((p) => (
          <li key={p.product_id}>
            <ProductCard
              name={p.name}
              nameTe={p.name_te}
              unit={p.unit}
              price={p.price}
              mrp={p.mrp}
              imageUrl={p.image_url}
              stock={p.effective_stock_status}
              shopLine={`${p.shop_name} · ${p.locality_name}`}
              href={`/shop/${p.storefront_slug}?from=${encodeURIComponent(from)}`}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
