import Image from "next/image";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { CategoryIcon } from "@/components/marketplace/category-icon";
import { OpenStatus } from "@/components/marketplace/open-status";
import { getT } from "@/i18n/server";
import { formatDistance } from "@/lib/geo";
import { presentCategory, presentTemplate } from "@/lib/marketplace/presentation";
import { cn } from "@/lib/utils";
import type { SearchResult } from "@/server/validation";

export const MODEL_LABELS: Record<string, string> = {
  visit_only: "Visit the shop",
  pickup: "Pickup",
  delivery: "Delivery",
  appointment: "By appointment",
  quotation: "Quotation",
};

/**
 * A published business. Shows only what the database holds: banner/logo, name,
 * category, area, tagline, the shop's own hours, and how many items it has
 * listed. No ratings, delivery times or offers exist in the data, so none appear.
 * The layout adapts to the storefront template (see lib/marketplace/presentation).
 */
export async function ShopCard({ shop, from, priority }: { shop: SearchResult; from?: string; priority?: boolean }) {
  const href = from ? `/shop/${shop.slug}?from=${encodeURIComponent(from)}` : `/shop/${shop.slug}`;
  const blurb = shop.headline && shop.headline !== "Sample listing" ? shop.headline : shop.snippet || shop.headline;
  const template = presentTemplate(shop.template_name);
  const { icon: Icon, tone } = presentCategory(shop.category_slug, shop.template_name);
  const [itemSingular, itemPlural] = template.itemNoun;
  const distance = formatDistance(shop.distance_km);
  const t = await getT();

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-2xl border bg-card shadow-card transition-all hover:-translate-y-0.5 hover:shadow-lift">
      <div className={cn("relative h-28 overflow-hidden bg-gradient-to-br", tone.edge)}>
        {shop.banner_url ? (
          <Image src={shop.banner_url} alt="" fill unoptimized sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw" priority={priority} className="object-cover" />
        ) : (
          <Icon aria-hidden className="absolute -right-3 -bottom-4 size-28 text-foreground/[0.07]" strokeWidth={1.25} />
        )}
        {shop.is_sample ? (
          <span className="absolute top-2 left-2 rounded-full bg-marigold px-2 py-0.5 text-[11px] font-semibold text-marigold-foreground">{t("shop.sample")}</span>
        ) : null}
      </div>

      <div className="relative flex flex-1 flex-col gap-2 p-4 pt-8">
        <div className="absolute -top-6 left-4">
          {shop.logo_url ? (
            <Image src={shop.logo_url} alt="" width={48} height={48} unoptimized className="size-12 rounded-xl border-2 border-card bg-card object-cover shadow-card" />
          ) : (
            <CategoryIcon slug={shop.category_slug} template={shop.template_name} className="size-12 border-2 border-card shadow-card" />
          )}
        </div>

        <div className="min-w-0 space-y-0.5">
          <h3 className="truncate text-base font-semibold leading-snug">
            <Link href={href} className="outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-3 focus-visible:after:ring-ring/60 focus-visible:after:rounded-2xl">
              {shop.shop_name}
            </Link>
          </h3>
          <p className="text-xs text-muted-foreground">
            {shop.category_name} · {shop.locality_name}
          </p>
        </div>

        {blurb ? <p className="line-clamp-2 text-sm text-foreground/80">{blurb}</p> : null}

        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
          {distance ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-primary">
              <MapPin aria-hidden className="size-3" /> {t("shop.away", { distance })}
            </span>
          ) : null}
          <OpenStatus hours={shop.operating_hours} />
          {template.cardHighlight === "items" && shop.item_count > 0 ? (
            <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
              {shop.item_count} {shop.item_count === 1 ? itemSingular : itemPlural} listed
            </span>
          ) : (
            shop.operating_models.slice(0, 2).map((m) => (
              <span key={m} className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                {MODEL_LABELS[m] ?? m}
              </span>
            ))
          )}
        </div>
      </div>
    </article>
  );
}
