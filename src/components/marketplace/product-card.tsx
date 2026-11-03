import Image from "next/image";
import Link from "next/link";
import { Package } from "lucide-react";
import { Price } from "@/components/product/price";
import { StockBadge } from "@/components/product/stock-badge";
import { presentTemplate } from "@/lib/marketplace/presentation";
import type { StockLabelKey } from "@/lib/stock";

export interface ProductCardProps {
  name: string;
  nameTe?: string | null | undefined;
  unit: string | null;
  price: number | null;
  mrp: number | null;
  imageUrl: string | null;
  /** The EFFECTIVE status: stale or unconfirmed stock arrives as call_to_confirm. */
  stock: StockLabelKey;
  /** Storefront template of the selling shop; decides whether a stock label is meaningful. */
  template?: string | null | undefined;
  /** Selling shop line, shown when the card appears outside that shop's own page. */
  shopLine?: string | undefined;
  /** Link target (the selling storefront). Omit on the storefront itself. */
  href?: string | undefined;
  /** Sample data is labelled so it can never pass as a real listing. */
  sample?: boolean | undefined;
}

/**
 * One listed item (product or service). Prices, MRP and availability are shown
 * exactly as the shop recorded them; a missing price reads "Call for price".
 * Used on the homepage, search results and storefronts.
 */
export function ProductCard({ name, nameTe, unit, price, mrp, imageUrl, stock, template, shopLine, href, sample }: ProductCardProps) {
  const t = presentTemplate(template);
  const body = (
    <>
      <div className={`relative w-full overflow-hidden bg-muted ${imageUrl ? "aspect-square" : "h-16"}`}>
        {imageUrl ? (
          <Image src={imageUrl} alt="" fill unoptimized loading="lazy" sizes="(min-width: 1024px) 20vw, 45vw" className="object-cover" />
        ) : (
          <Package aria-hidden className="absolute inset-0 m-auto size-7 text-muted-foreground/40" strokeWidth={1.25} />
        )}
        {sample ? <span className="absolute top-2 left-2 rounded-full bg-marigold px-2 py-0.5 text-[11px] font-semibold text-marigold-foreground">Sample</span> : null}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="line-clamp-2 text-sm leading-snug font-medium">
          {name}
          {nameTe ? (
            <span lang="te" className="block text-xs font-normal text-muted-foreground">
              {nameTe}
            </span>
          ) : null}
        </p>
        <Price price={price} mrp={mrp} unit={unit} />
        {t.showStock ? (
          <div className="pt-0.5">
            <StockBadge status={stock} />
          </div>
        ) : null}
        {shopLine ? <p className="mt-auto truncate pt-1 text-xs text-muted-foreground">{shopLine}</p> : null}
      </div>
    </>
  );
  const cls = "flex h-full flex-col overflow-hidden rounded-2xl border bg-card shadow-card transition-all";
  return href ? (
    <Link href={href} className={`${cls} hover:-translate-y-0.5 hover:shadow-lift focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
