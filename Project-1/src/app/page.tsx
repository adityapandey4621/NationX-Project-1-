import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { ArrowRight, BadgeCheck, ClipboardCheck, Compass, HeartHandshake, Layers, Rocket, Search, Smartphone, Store } from "lucide-react";
import { ShopCard } from "@/components/discovery/shop-card";
import { CategoryIcon } from "@/components/marketplace/category-icon";
import { CategoryTile } from "@/components/marketplace/category-tile";
import { CommunityPulse } from "@/components/marketplace/community-pulse";
import { OpenStatus } from "@/components/marketplace/open-status";
import { ProductCard } from "@/components/marketplace/product-card";
import { SearchBox } from "@/components/marketplace/search-box";
import { SectionHeading } from "@/components/marketplace/section-heading";
import { loadChrome } from "@/components/site/chrome-data";
import { getT } from "@/i18n/server";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { renderHomeSections, resolveHomeLayout, type HomeSectionSetting } from "@/lib/homepage-layout";
import { buildListingHref } from "@/lib/search-url";
import { isSupabaseConfigured } from "@/server/config/env";
import { getHomepageData, listActiveBanners, listFeaturedShops, listHomepageSections, type HomepageData } from "@/server/services";
import type { Banner, SearchResult } from "@/server/validation";
import { createRequestClient } from "@/server/supabase/server";

async function load(localityId: string | null): Promise<HomepageData | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    return await getHomepageData(await createRequestClient(), localityId, 8);
  } catch (e) {
    unstable_rethrow(e);
    console.error("Homepage load failed", e);
    return null;
  }
}

/** Admin-curated extras. Both are empty by default, and a failure here must never break the homepage. */
async function loadCuration(localityId: string | null): Promise<{ banners: Banner[]; featured: SearchResult[]; layout: HomeSectionSetting[] | null }> {
  if (!isSupabaseConfigured()) return { banners: [], featured: [], layout: null };
  try {
    const db = await createRequestClient();
    // The layout is read on its own so a problem with it can never hide the banners or featured shops (or the reverse).
    const [banners, featured, layout] = await Promise.all([listActiveBanners(db, localityId), listFeaturedShops(db, localityId, 4), listHomepageSections(db)]);
    return { banners, featured, layout };
  } catch (e) {
    unstable_rethrow(e);
    console.error("Homepage curation failed", e);
    return { banners: [], featured: [], layout: null };
  }
}

export default async function Home() {
  const [{ locality }, t] = await Promise.all([loadChrome(), getT()]);
  const [data, curated] = await Promise.all([load(locality?.id ?? null), loadCuration(locality?.id ?? null)]);
  const scoped = locality?.slug;
  const withStores = data?.categories.filter((c) => c.shop_count > 0) ?? [];
  const placeLabel = locality ? locality.name : "Khammam";
  const layout = resolveHomeLayout(curated.layout);

  return (
    <div>
      {/* Hero ------------------------------------------------------------------ */}
      <section aria-labelledby="hero-h" className="border-b bg-brand-soft">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-10 sm:py-14 lg:grid-cols-[1.2fr_0.8fr] lg:py-16">
          <div className="space-y-6">
            <p className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-card px-3 py-1 text-xs font-semibold text-primary">
              <span aria-hidden className="size-1.5 rounded-full bg-marigold" />
              {t("home.kicker", { place: placeLabel })}
            </p>
            <div className="space-y-3">
              <h1 id="hero-h" className="text-4xl leading-[1.05] font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
                {t("home.title")}
              </h1>
              <p className="max-w-xl text-base text-foreground/75 sm:text-lg">
                {t("home.subtitle")}
              </p>
            </div>

            <SearchBox primary locality={scoped} placeholder={t("search.placeholderLong")} buttonLabel={t("search.button")} />

            {withStores.length > 0 ? (
              <ul className="flex flex-wrap gap-2" aria-label="Popular categories">
                {withStores.slice(0, 6).map((c) => (
                  <li key={c.id}>
                    <Link
                      href={buildListingHref(`/category/${c.slug}`, { locality: scoped })}
                      className="inline-flex h-9 items-center rounded-full border bg-card px-3.5 text-sm font-medium shadow-card hover:border-primary/40 hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      {c.name}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}

            <p>
              <Link href="/app" className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-card px-4 py-2 text-sm font-semibold text-primary shadow-card outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50">
                <Smartphone aria-hidden className="size-4" /> {t("nav.app")}
              </Link>
            </p>

            <ul className="grid gap-x-6 gap-y-2 text-sm text-foreground/75 sm:grid-cols-2">
              <li className="flex items-center gap-2"><BadgeCheck aria-hidden className="size-4 shrink-0 text-primary" />{t("home.trustReviewed")}</li>
              <li className="flex items-center gap-2"><Compass aria-hidden className="size-4 shrink-0 text-primary" />{t("home.trustNoSignup")}</li>
            </ul>
          </div>

          <HeroPanel data={data} />
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-16 px-4 py-12 sm:py-16">
        {data === null ? (
          <Card role="alert">
            <CardHeader>
              <CardTitle>Stores are unavailable right now</CardTitle>
              <CardDescription>We couldn&apos;t load the directory. Please try again in a moment.</CardDescription>
            </CardHeader>
          </Card>
        ) : null}
        {renderHomeSections(layout, {
          banners: curated.banners.length > 0 ? (
          <ul aria-label="Announcements" className="grid gap-3 sm:grid-cols-2">
            {curated.banners.map((b) => {
              const inner = (
                <>
                  <p className="font-semibold">{b.title}</p>
                  {b.body ? <p className="mt-0.5 text-sm text-foreground/75">{b.body}</p> : null}
                </>
              );
              const cls = "block rounded-2xl border bg-accent p-4 shadow-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
              return (
                <li key={b.id}>
                  {b.link_url?.startsWith("/") ? (
                    <Link href={b.link_url} className={cls}>{inner}</Link>
                  ) : b.link_url ? (
                    <a href={b.link_url} target="_blank" rel="noopener noreferrer" className={cls}>{inner}</a>
                  ) : (
                    <div className={cls}>{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
          ) : null,
          featured: curated.featured.length > 0 ? (
          <section aria-labelledby="featured-h" className="space-y-5">
            <SectionHeading id="featured-h" kicker="Handpicked by NationX" title="Featured stores" />
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {curated.featured.map((s) => (
                <li key={s.storefront_id}>
                  <ShopCard shop={s} from="/" />
                </li>
              ))}
            </ul>
          </section>
          ) : null,
          categories: data ? (
            <section aria-labelledby="cats-h" className="space-y-5">
              <SectionHeading id="cats-h" kicker={t("home.cats.kicker")} title={t("home.cats.title")} href="/explore" hrefLabel={t("home.cats.all")} />
              {data.categories.length === 0 ? (
                <p className="text-sm text-muted-foreground">Categories will appear here soon.</p>
              ) : (
                <ul className="scrollbar-none -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4">
                  {data.categories.map((c) => (
                    <li key={c.id} className="contents">
                      <CategoryTile
                        layout="rail"
                        name={c.name}
                        slug={c.slug}
                        template={c.default_template}
                        href={buildListingHref(`/category/${c.slug}`, { locality: scoped })}
                        shopCount={scoped ? undefined : c.shop_count}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null,
          stores: data ? (
            <section aria-labelledby="recent-h" className="space-y-5">
              <SectionHeading
                id="recent-h"
                kicker={locality ? t("home.stores.kickerNear") : t("home.stores.kickerLocal")}
                title={locality ? t("home.stores.titleIn", { area: locality.name }) : t("home.stores.titleAll")}
                href={buildListingHref("/explore", { locality: scoped, sort: "newest" })}
                hrefLabel={t("home.stores.seeAll")}
              />
              {data.recent.results.length === 0 ? (
                <Card>
                  <CardHeader>
                    <CardTitle>{locality ? `No stores in ${locality.name} yet` : "No stores are listed yet"}</CardTitle>
                    <CardDescription>
                      Stores appear after NationX verifies them. Can&apos;t wait? Tell us what you need and we&apos;ll look for it.
                    </CardDescription>
                  </CardHeader>
                  <div className="flex flex-wrap gap-2 px-4 pb-4">
                    <Link href="/help-me-find-it" className={buttonVariants({ size: "lg" })}>
                      Help me find it
                    </Link>
                    {locality ? (
                      <Link href="/explore?locality=all" className={buttonVariants({ variant: "outline", size: "lg" })}>
                        Browse all areas
                      </Link>
                    ) : (
                      <Link href="/merchant/apply" className={buttonVariants({ variant: "outline", size: "lg" })}>
                        Add your shop
                      </Link>
                    )}
                  </div>
                </Card>
              ) : (
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {data.recent.results.map((shop, i) => (
                    <li key={shop.storefront_id}>
                      <ShopCard shop={shop} from="/" priority={i < 4} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null,
          items: data && data.items.length > 0 ? (
              <section aria-labelledby="items-h" className="space-y-5">
                <SectionHeading id="items-h" kicker={t("home.items.kicker")} title={t("home.items.title")} />
                <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
                  {data.items.map((p) => (
                    <li key={p.product_id}>
                      <ProductCard
                        name={p.name}
                        nameTe={p.name_te}
                        unit={p.unit}
                        price={p.price}
                        mrp={p.mrp}
                        imageUrl={p.image_url}
                        stock={p.effective_stock_status}
                        template={p.template_name}
                        sample={p.is_sample}
                        shopLine={`${p.shop_name} · ${p.locality_name}`}
                        href={`/shop/${p.storefront_slug}?from=%2F`}
                      />
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">{t("home.items.note")}</p>
              </section>
          ) : null,
          community: data ? <CommunityPulse stats={data.community} placeLabel={placeLabel} waitlistLabel={t("waitlist.cta")} /> : null,
          areas: data && data.localities.length > 1 ? (
              <section aria-labelledby="areas-h" className="space-y-4">
                <SectionHeading id="areas-h" kicker={t("home.areas.kicker")} title={t("home.areas.title")} />
                <ul className="flex flex-wrap gap-2">
                  {data.localities.map((l) => (
                    <li key={l.id}>
                      <Link
                        href={`/locality/${l.slug}`}
                        className="inline-flex h-10 items-center gap-2 rounded-full border bg-card px-4 text-sm font-medium shadow-card hover:border-primary/40 hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                      >
                        {l.name}
                        <span className="text-xs font-normal text-muted-foreground">{l.shop_count}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
          ) : null,
        })}

        {/* What is NationX ------------------------------------------------------- */}
        <section aria-labelledby="about-h" className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14">
          <div className="space-y-4">
            <p className="text-xs font-semibold tracking-wider text-primary uppercase">About</p>
            <h2 id="about-h" className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
              What is NationX?
            </h2>
            <p className="text-foreground/80">
              Local shops are hard to find online, and shoppers lose time walking from store to store to check. NationX brings the businesses around you
              into one searchable place. We&apos;re starting in Khammam, with the aim of connecting local commerce well beyond it.
            </p>
          </div>
          <ul className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            {[
              { icon: Search, title: "For customers", body: "Search by shop, item, category or area, open a store's page, then call or get directions. Prices and stock appear only when a shop has confirmed them." },
              { icon: Store, title: "For local businesses", body: "Apply once. When our team has verified your business, your public page is created automatically. There is no website to build." },
              { icon: Layers, title: "Built to grow", body: "Groceries, food, fashion, services and more share one platform, so new kinds of business can be added as they join." },
            ].map(({ icon: Icon, title, body }) => (
              <li key={title} className="rounded-2xl border bg-card p-5 shadow-card">
                <span aria-hidden className="inline-flex size-10 items-center justify-center rounded-xl bg-brand-soft text-primary">
                  <Icon className="size-5" strokeWidth={1.75} />
                </span>
                <h3 className="mt-3 font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-foreground/75">{body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* Help me find it ------------------------------------------------------- */}
        <section aria-labelledby="hmf-h" className="overflow-hidden rounded-3xl border bg-accent">
          <div className="grid items-center gap-6 p-6 sm:p-10 lg:grid-cols-[1fr_auto]">
            <div className="max-w-2xl space-y-3">
              <span aria-hidden className="inline-flex size-11 items-center justify-center rounded-xl bg-marigold text-marigold-foreground">
                <HeartHandshake className="size-6" strokeWidth={1.75} />
              </span>
              <h2 id="hmf-h" className="text-2xl font-bold tracking-tight sm:text-3xl">
                Can&apos;t find what you need? Let us look.
              </h2>
              <p className="text-accent-foreground/85">
                Tell us the item and your area. Our team searches for a local source and updates your request. We don&apos;t promise availability until a real shop has confirmed it.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 lg:flex-col">
              <Link href="/help-me-find-it" className={buttonVariants({ size: "lg" })}>
                Help me find it <ArrowRight aria-hidden />
              </Link>
              <Link href="/help-me-find-it/track" className={buttonVariants({ variant: "outline", size: "lg" })}>
                Track a request
              </Link>
            </div>
          </div>
        </section>

        {/* Merchant acquisition -------------------------------------------------- */}
        <section aria-labelledby="merchant-h" className="rounded-3xl bg-primary p-6 text-primary-foreground sm:p-10">
          <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr] lg:items-center">
            <div className="space-y-4">
              <p className="text-xs font-semibold tracking-wider text-marigold uppercase">For businesses</p>
              <h2 id="merchant-h" className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
                Own a shop in Khammam? Get your page on NationX.
              </h2>
              <p className="text-primary-foreground/85">Customers search by shop, item and area. Apply once and your storefront is created for you after verification.</p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Link href="/merchant/apply" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-marigold px-5 text-base font-medium text-marigold-foreground outline-none hover:bg-marigold/90 focus-visible:ring-3 focus-visible:ring-ring/50">
                  Add your shop <ArrowRight aria-hidden />
                </Link>
                <Link href="/merchant" className={buttonVariants({ variant: "outline", size: "lg", className: "border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground" })}>
                  Merchant dashboard
                </Link>
              </div>
            </div>
            <ol className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              {[
                { icon: ClipboardCheck, title: "1. Apply", body: "Share your business details and contact information." },
                { icon: BadgeCheck, title: "2. We verify", body: "Our team reviews your application." },
                { icon: Rocket, title: "3. You go live", body: "Your public page and link are generated automatically." },
              ].map(({ icon: Icon, title, body }) => (
                <li key={title} className="rounded-2xl bg-primary-foreground/10 p-4">
                  <Icon aria-hidden className="size-5 text-marigold" strokeWidth={1.75} />
                  <h3 className="mt-2 font-semibold">{title}</h3>
                  <p className="mt-0.5 text-sm text-primary-foreground/80">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * Right-hand hero composition built from real directory data: the newest stores when
 * there are any, otherwise the categories. Nothing here is fabricated or hardcoded.
 */
function HeroPanel({ data }: { data: HomepageData | null }) {
  const stores = data?.recent.results.slice(0, 3) ?? [];
  const categories = data?.categories.slice(0, 4) ?? [];
  const counts = data
    ? [
        { n: data.recent.total, label: data.recent.total === 1 ? "store" : "stores" },
        { n: data.categories.filter((c) => c.shop_count > 0).length, label: "categories" },
        { n: data.localities.filter((l) => l.shop_count > 0).length, label: "areas" },
      ].filter((c) => c.n > 0)
    : [];

  return (
    <div className="rounded-3xl border bg-card p-4 shadow-lift sm:p-5" aria-label="Latest on NationX">
      {stores.length > 0 ? (
        <>
          <p className="px-1 pb-3 text-sm font-semibold">New on NationX</p>
          <ul className="space-y-2">
            {stores.map((s) => (
              <li key={s.storefront_id}>
                <Link
                  href={`/shop/${s.slug}?from=%2F`}
                  className="flex items-center gap-3 rounded-2xl border bg-background p-3 transition-colors hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <CategoryIcon slug={s.category_slug} template={s.template_name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{s.shop_name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {s.category_name} · {s.locality_name}
                    </span>
                  </span>
                  <OpenStatus hours={s.operating_hours} className="hidden sm:inline-flex" />
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : categories.length > 0 ? (
        <>
          <p className="px-1 pb-3 text-sm font-semibold">Categories on NationX</p>
          <ul className="grid grid-cols-2 gap-2">
            {categories.map((c) => (
              <li key={c.id}>
                <CategoryTile name={c.name} slug={c.slug} template={c.default_template} href={`/category/${c.slug}`} />
              </li>
            ))}
          </ul>
          <p className="px-1 pt-3 text-xs text-muted-foreground">Stores appear here once NationX has verified them.</p>
        </>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">Stores and categories will appear here as businesses join NationX.</p>
      )}
      {counts.length > 0 ? (
        <ul className="mt-4 flex divide-x rounded-2xl bg-brand-soft py-3 text-center">
          {counts.map((c) => (
            <li key={c.label} className="flex-1 px-2">
              <span className="block text-xl font-bold text-primary">{c.n}</span>
              <span className="block text-xs text-muted-foreground">{c.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
