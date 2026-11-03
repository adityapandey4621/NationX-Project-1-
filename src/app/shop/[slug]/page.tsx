import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BadgeCheck, Clock, MapPin, MessageCircle, Navigation, Phone, QrCode } from "lucide-react";
import { CategoryIcon } from "@/components/marketplace/category-icon";
import { OpenStatus } from "@/components/marketplace/open-status";
import { ProductCard } from "@/components/marketplace/product-card";
import { ShareButton } from "@/components/marketplace/share-button";
import { StorefrontBeacon } from "@/components/marketplace/storefront-beacon";
import { buttonVariants } from "@/components/ui/button";
import { formatTime12h } from "@/lib/opening-hours";
import { presentCategory, presentTemplate } from "@/lib/marketplace/presentation";
import { safeBackHref } from "@/lib/search-url";
import { cn } from "@/lib/utils";
import { getPublicStorefront, listPublicProducts } from "@/server/services";
import { getT } from "@/i18n/server";
import { siteOrigin } from "@/server/site-origin";
import { createRequestClient } from "@/server/supabase/server";
import type { PublicStorefront } from "@/server/validation";

const MODEL_LABELS: Record<string, string> = {
  visit_only: "Visit the shop",
  pickup: "Pickup",
  delivery: "Delivery",
  appointment: "By appointment",
  quotation: "Quotation",
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

async function load(slug: string) {
  return getPublicStorefront(await createRequestClient(), slug);
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const sf = await load(slug);
  if (!sf) return { title: "Shop not available", robots: { index: false } };
  return {
    title: sf.meta_title ?? sf.shop.name,
    description: sf.meta_description ?? `${sf.shop.name} in ${sf.shop.locality.name}`,
    openGraph: { title: sf.meta_title ?? sf.shop.name, description: sf.meta_description ?? undefined, type: "website" },
  };
}

function directionsUrl(sf: PublicStorefront): string {
  const { shop } = sf;
  if (shop.latitude != null && shop.longitude != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${shop.latitude},${shop.longitude}`;
  }
  const query = [shop.address_line, shop.locality.name, shop.pincode ?? shop.locality.pincode].filter(Boolean).join(", ");
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
}

/** schema.org markup. `<` is escaped so shop-controlled text can't terminate the script tag. */
function jsonLd(sf: PublicStorefront): string {
  const { shop } = sf;
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: shop.name,
    description: sf.description ?? undefined,
    telephone: shop.phone,
    image: sf.logo_url ?? sf.banner_url ?? undefined,
    address: {
      "@type": "PostalAddress",
      streetAddress: shop.address_line,
      addressLocality: shop.locality.name,
      postalCode: shop.pincode ?? shop.locality.pincode,
      addressRegion: "Telangana",
      addressCountry: "IN",
    },
    ...(shop.latitude != null && shop.longitude != null
      ? { geo: { "@type": "GeoCoordinates", latitude: shop.latitude, longitude: shop.longitude } }
      : {}),
  }).replace(/</g, "\\u003c");
}

export default async function StorefrontPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const t = await getT();
  // Only listing pages on this site are accepted as a "back" target.
  const backHref = safeBackHref((await searchParams).from);
  // Unpublished, hidden, suspended and unknown storefronts are all indistinguishable 404s.
  const sf = await load(slug);
  if (!sf) notFound();

  const { shop } = sf;
  // The showcase is optional: a failure here must not take the whole storefront down.
  const products = await listPublicProducts(await createRequestClient(), shop.id).catch((e: unknown) => {
    console.error("Storefront products failed", e);
    return [];
  });
  const template = presentTemplate(sf.template_name);
  const { icon: CoverIcon, tone } = presentCategory(shop.category.slug, sf.template_name);
  const waNumber = shop.whatsapp?.replace(/\D/g, "");
  const closedDays = shop.operating_hours.closed_days;
  const canCall = sf.supported_actions.includes("call");
  const canWhatsApp = sf.supported_actions.includes("whatsapp") && Boolean(waNumber);
  const canDirections = sf.supported_actions.includes("directions");
  const hasActions = canCall || canWhatsApp || canDirections;
  const [, itemPlural] = template.itemNoun;
  const shareUrl = `${await siteOrigin()}/shop/${sf.slug}`;

  const actionButtons = (size: "lg" | "default", full?: boolean) => (
    <>
      {canCall ? (
        <a data-track="call" href={`tel:${shop.phone}`} className={buttonVariants({ size, className: full ? "flex-1" : "" })}>
          <Phone aria-hidden /> {t("shop.call")}
        </a>
      ) : null}
      {canWhatsApp ? (
        <a data-track="whatsapp" href={`https://wa.me/${waNumber}`} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", size, className: full ? "flex-1" : "" })}>
          <MessageCircle aria-hidden /> {t("shop.whatsapp")}
        </a>
      ) : null}
      {canDirections ? (
        <a data-track="directions" href={directionsUrl(sf)} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", size, className: full ? "flex-1" : "" })}>
          <Navigation aria-hidden /> {t("shop.directions")}
        </a>
      ) : null}
    </>
  );

  return (
    <article className={cn("pb-10", hasActions && "pb-28 lg:pb-10")}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(sf) }} />
      {sf.is_sample ? null : <StorefrontBeacon slug={sf.slug} />}

      <div className={cn("relative h-44 w-full overflow-hidden bg-gradient-to-br sm:h-60", tone.edge)}>
        {sf.banner_url ? (
          <Image src={sf.banner_url} alt="" fill unoptimized priority sizes="100vw" className="object-cover" />
        ) : (
          <CoverIcon aria-hidden className="absolute -right-6 -bottom-10 size-64 text-foreground/[0.06]" strokeWidth={1} />
        )}
      </div>

      <div className="mx-auto max-w-5xl px-4">
        {backHref ? (
          <Link href={backHref} className="mt-4 inline-flex items-center gap-1.5 rounded-lg py-1 text-sm font-medium text-primary underline-offset-4 hover:underline">
            <ArrowLeft aria-hidden className="size-4" /> {t("shop.back")}
          </Link>
        ) : null}

        <header className={cn("relative flex flex-col gap-4 sm:flex-row sm:items-end", backHref ? "mt-2" : "-mt-12 sm:-mt-14")}>
          {sf.logo_url ? (
            <Image src={sf.logo_url} alt={`${shop.name} logo`} width={96} height={96} unoptimized className="size-20 shrink-0 rounded-2xl border-4 border-background bg-card object-cover shadow-lift sm:size-24" />
          ) : (
            <CategoryIcon slug={shop.category.slug} template={sf.template_name} className="size-20 rounded-2xl border-4 border-background shadow-lift sm:size-24" iconClassName="size-9" />
          )}
          <div className="min-w-0 flex-1 space-y-2 sm:pb-1">
            <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">{shop.name}</h1>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <Link href={`/category/${shop.category.slug}`} className="font-medium text-foreground/80 underline-offset-4 hover:underline">
                {shop.category.name}
              </Link>
              <span aria-hidden>·</span>
              <Link href={`/locality/${shop.locality.slug}`} className="underline-offset-4 hover:underline">
                {shop.locality.name}
              </Link>
              <OpenStatus hours={shop.operating_hours} />
              {sf.is_sample ? (
                <span className="rounded-full bg-marigold px-2 py-0.5 text-xs font-semibold text-marigold-foreground">{t("shop.sample")}</span>
              ) : (
                // A storefront exists only after an admin approved the application, so this is literally true.
                <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">
                  <BadgeCheck aria-hidden className="size-3.5" /> {t("shop.verified")}
                </span>
              )}
            </p>
            {sf.headline && !sf.is_sample ? <p className="text-foreground/80">{sf.headline}</p> : null}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <ShareButton url={shareUrl} title={shop.name} label={t("shop.share")} copiedLabel={t("shop.shareCopied")} />
              <Link href={`/shop/${sf.slug}/poster`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                <QrCode aria-hidden className="size-4" /> {t("shop.qr")}
              </Link>
            </div>
          </div>
          {hasActions ? <nav aria-label="Contact" className="hidden gap-2 lg:flex">{actionButtons("lg")}</nav> : null}
        </header>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
          <div className="min-w-0 space-y-10">
            {sf.description ? (
              <section aria-labelledby="about-h" className="space-y-2">
                <h2 id="about-h" className="text-xl font-semibold">
                  {t("shop.about")}
                </h2>
                <p className="whitespace-pre-line text-foreground/85">{sf.description}</p>
              </section>
            ) : null}

            {products.length > 0 ? (
              <section aria-labelledby="items-h" className="space-y-3">
                <h2 id="items-h" className="text-xl font-semibold">
                  {template.itemsHeading} <span className="text-base font-normal text-muted-foreground">({products.length})</span>
                </h2>
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
                  {products.map((p) => (
                    <li key={p.id}>
                      <ProductCard name={p.name} nameTe={p.name_te} unit={p.unit} price={p.price} mrp={p.mrp} imageUrl={p.image_url} stock={p.effective_stock_status} template={sf.template_name} />
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  {template.showStock
                    ? `Availability and prices are as last confirmed by the shop. Items marked “Call to confirm” may or may not be available - please call before visiting.`
                    : `Prices are as listed by the shop. Please call to confirm before visiting.`}
                </p>
              </section>
            ) : (
              <section aria-labelledby="items-h" className="rounded-2xl border border-dashed p-5">
                <h2 id="items-h" className="font-semibold">
                  No {itemPlural} listed yet
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">This shop hasn&apos;t added its {itemPlural} to NationX. Call or visit to ask what&apos;s available.</p>
              </section>
            )}

            {sf.gallery_urls.length > 0 ? (
              <section aria-labelledby="photos-h" className="space-y-3">
                <h2 id="photos-h" className="text-xl font-semibold">
                  {t("shop.photos")}
                </h2>
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {sf.gallery_urls.map((url, i) => (
                    <li key={url} className="relative aspect-[4/3] overflow-hidden rounded-xl bg-muted">
                      <a href={url} target="_blank" rel="noopener noreferrer" className="absolute inset-0 outline-none focus-visible:ring-3 focus-visible:ring-ring/60" aria-label={`Open ${shop.name} photo ${i + 1} full size`}>
                        <Image src={url} alt={`${shop.name} photo ${i + 1}`} fill unoptimized loading="lazy" sizes="(min-width: 640px) 33vw, 50vw" className="object-cover transition-transform hover:scale-105" />
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>

          <aside aria-labelledby="visit-h" className="lg:sticky lg:top-24 lg:self-start">
            <div className="space-y-4 rounded-2xl border bg-card p-5 shadow-card">
              <h2 id="visit-h" className="text-lg font-semibold">
                Visit
              </h2>
              <address className="flex gap-3 text-sm not-italic">
                <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>
                  {shop.address_line}
                  {shop.landmark ? <span className="block text-muted-foreground">Near {shop.landmark}</span> : null}
                  <span className="block">
                    {shop.locality.name}, Khammam{shop.pincode ?? shop.locality.pincode ? ` – ${shop.pincode ?? shop.locality.pincode}` : ""}
                  </span>
                </span>
              </address>
              <p className="flex gap-3 text-sm">
                <Clock aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>
                  <strong>Hours:</strong> {formatTime12h(shop.operating_hours.opens)} – {formatTime12h(shop.operating_hours.closes)}
                  {closedDays.length ? <span className="block text-muted-foreground">Closed {closedDays.map(cap).join(", ")}</span> : null}
                </span>
              </p>
              <ul className="flex flex-wrap gap-2" aria-label="How to shop here">
                {shop.operating_models.map((m) => (
                  <li key={m} className="rounded-full border px-2.5 py-0.5 text-xs">
                    {MODEL_LABELS[m] ?? m}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">Hours are as provided by the shop. Please call to confirm availability.</p>
            </div>
          </aside>
        </div>
      </div>

      {hasActions ? (
        <nav aria-label="Contact" className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lift lg:hidden">
          {actionButtons("lg", true)}
        </nav>
      ) : null}
    </article>
  );
}
