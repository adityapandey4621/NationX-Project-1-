import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import Link from "next/link";
import { X } from "lucide-react";
import { Pagination } from "@/components/discovery/pagination";
import { SearchForm } from "@/components/discovery/search-form";
import { ProductResults } from "@/components/discovery/product-results";
import { MODEL_LABELS, ShopCard } from "@/components/discovery/shop-card";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NearMe } from "@/components/marketplace/near-me";
import { getT } from "@/i18n/server";
import { nearMeLabels } from "@/i18n/near-me-labels";
import { LOCALITY_COOKIE, NEAR_COOKIE } from "@/lib/constants";
import { parseCoords } from "@/lib/geo";
import { buildListingHref, firstParam, pageToOffset, parsePage, totalPages, type SearchView } from "@/lib/search-url";
import { listActiveCategories, listActiveLocalities, searchProducts, searchStorefronts } from "@/server/services";
import { createRequestClient } from "@/server/supabase/server";
import {
  DEFAULT_PAGE_SIZE,
  operatingModelSchema,
  searchSortSchema,
  type Category,
  type Locality,
} from "@/server/validation";

type RawParams = Record<string, string | string[] | undefined>;

interface DiscoveryResultsProps {
  /** Route that renders this list; used for form action, pagination and "back to results". */
  basePath: string;
  searchParams: RawParams;
  /** Set when the path itself fixes the category / locality (/category/x, /locality/y). */
  fixedCategory?: Category;
  fixedLocality?: Locality;
  /** Also list matching items (only meaningful with a text query; used on /search). */
  showProducts?: boolean;
}

function ErrorCard({ href }: { href: string }) {
  return (
    <Card role="alert">
      <CardHeader>
        <CardTitle>We couldn&apos;t load stores right now</CardTitle>
        <CardDescription>
          Please check your connection and{" "}
          <Link href={href} className="underline underline-offset-4">
            try again
          </Link>
          .
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

function Chip({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-8 items-center gap-1.5 rounded-full border bg-card px-3 text-xs font-medium shadow-card hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {children}
      <X aria-hidden className="size-3.5 text-muted-foreground" />
      <span className="sr-only">(remove filter)</span>
    </Link>
  );
}

/**
 * Shared listing used by /explore, /search, /category/[slug] and /locality/[slug]:
 * search box with typeahead, filters, active-filter chips, results (real published
 * stores only), pagination, and empty/error states. A remembered area (cookie) is the
 * default scope; `locality=all` overrides it.
 */
export async function DiscoveryResults({ basePath, searchParams, fixedCategory, fixedLocality, showProducts }: DiscoveryResultsProps) {
  const t = await getT();
  const q = firstParam(searchParams.q)?.slice(0, 80);
  const model = operatingModelSchema.safeParse(firstParam(searchParams.model));
  const sort = searchSortSchema.safeParse(firstParam(searchParams.sort));
  const page = parsePage(searchParams.page);

  let db: SupabaseClient;
  let categories: Category[];
  let localities: Locality[];
  let outcome;
  try {
    db = await createRequestClient();
    [categories, localities] = await Promise.all([listActiveCategories(db), listActiveLocalities(db)]);
  } catch (e) {
    console.error("Discovery taxonomy failed", e);
    return <ErrorCard href={basePath} />;
  }

  const category = fixedCategory ?? categories.find((c) => c.slug === firstParam(searchParams.category));
  const localityParam = firstParam(searchParams.locality);
  const allAreas = localityParam === "all";
  const rememberedSlug = !fixedLocality && !localityParam ? (await cookies()).get(LOCALITY_COOKIE)?.value : undefined;
  const locality =
    fixedLocality ??
    (allAreas ? undefined : localities.find((l) => l.slug === (localityParam ?? rememberedSlug)));
  const fromCookie = !fixedLocality && !localityParam && locality !== undefined;
  // A position the visitor chose to share (cookie). Used only for distance/sort, never stored.
  const coords = parseCoords((await cookies()).get(NEAR_COOKIE)?.value);

  const view: SearchView = {
    q,
    category: fixedCategory ? undefined : category?.slug,
    // The remembered area stays implicit so URLs stay clean; an explicit choice is kept in the URL.
    locality: fixedLocality || fromCookie ? undefined : allAreas ? "all" : locality?.slug,
    model: model.success ? model.data : undefined,
    sort: sort.success ? sort.data : undefined,
  };
  const formValues = { ...view, locality: fixedLocality ? undefined : (locality?.slug ?? "all") };

  try {
    outcome = await searchStorefronts(db, {
      q,
      category_id: category?.id,
      locality_id: locality?.id,
      model: view.model,
      // With a shared position and no text query, nearest-first is the natural default.
      sort: view.sort ?? (coords && !q ? "nearest" : undefined),
      limit: DEFAULT_PAGE_SIZE,
      offset: pageToOffset(page),
      ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
    });
  } catch (e) {
    console.error("Search failed", e);
    return (
      <div className="space-y-6">
        <SearchForm action={basePath} categories={categories} localities={localities} values={formValues} hide={{ category: !!fixedCategory, locality: !!fixedLocality }} canSortNearest={!!coords} />
        <ErrorCard href={buildListingHref(basePath, { ...view, page })} />
      </div>
    );
  }

  const here = buildListingHref(basePath, { ...view, page });
  // Items are a bonus section on the first page; if it fails the store results still show.
  const items =
    showProducts && q && page === 1
      ? await searchProducts(db, { q, category_id: category?.id, locality_id: locality?.id, limit: 8 }).catch((e: unknown) => {
          console.error("Item search failed", e);
          return null;
        })
      : null;
  const pages = totalPages(outcome.total);
  const hasFilters = Boolean(q || view.category || locality || view.model || fixedCategory);
  const requestHref = `/help-me-find-it?${new URLSearchParams({
    ...(q ? { item: q } : {}),
    ...(locality ? { locality: locality.slug } : {}),
    ...(category ? { category: category.slug } : {}),
  }).toString()}`;

  const waitlistHref = locality ? `/waitlist?locality=${locality.slug}` : "/waitlist";

  const chips: { key: string; label: string; href: string }[] = [
    ...(q ? [{ key: "q", label: `“${q}”`, href: buildListingHref(basePath, { ...view, q: undefined }) }] : []),
    ...(view.category && category ? [{ key: "category", label: category.name, href: buildListingHref(basePath, { ...view, category: undefined }) }] : []),
    ...(locality && !fixedLocality
      ? [{ key: "locality", label: locality.name, href: buildListingHref(basePath, { ...view, locality: "all" }) }]
      : []),
    ...(view.model ? [{ key: "model", label: MODEL_LABELS[view.model] ?? view.model, href: buildListingHref(basePath, { ...view, model: undefined }) }] : []),
  ];

  return (
    <div className="space-y-6">
      <SearchForm action={basePath} categories={categories} localities={localities} values={formValues} hide={{ category: !!fixedCategory, locality: !!fixedLocality }} canSortNearest={!!coords} />
      <NearMe active={!!coords} labels={nearMeLabels(t)} />

      {chips.length > 0 ? (
        <ul className="flex flex-wrap items-center gap-2" aria-label="Active filters">
          {chips.map((c) => (
            <li key={c.key}>
              <Chip href={c.href}>{c.label}</Chip>
            </li>
          ))}
          {fromCookie ? <li className="text-xs text-muted-foreground">Your remembered area</li> : null}
        </ul>
      ) : null}

      {items && q ? <ProductResults results={items.results} total={items.total} q={q} from={here} /> : null}

      {outcome.results.length > 0 ? (
        <section aria-label="Stores" className="space-y-4">
          <p className="text-sm text-muted-foreground" role="status">
            {outcome.total} {outcome.total === 1 ? "store" : "stores"}
            {q ? <> for “{q}”</> : null}
            {pages > 1 ? <> · page {page} of {pages}</> : null}
          </p>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {outcome.results.map((shop) => (
              <li key={shop.storefront_id}>
                <ShopCard shop={shop} from={here} />
              </li>
            ))}
          </ul>
          <Pagination basePath={basePath} view={view} page={page} pages={pages} />
        </section>
      ) : page > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>No more results</CardTitle>
            <CardDescription>
              <Link href={buildListingHref(basePath, view)} className="underline underline-offset-4">
                Back to the first page
              </Link>
            </CardDescription>
          </CardHeader>
        </Card>
      ) : hasFilters ? (
        <Card>
          <CardHeader>
            <CardTitle>No stores found{q ? ` for “${q}”` : ""}</CardTitle>
            <CardDescription>
              Try a different spelling, fewer words, or remove a filter. Stores appear here only after NationX has verified and published them.
            </CardDescription>
          </CardHeader>
          <div className="flex flex-wrap gap-2 px-4 pb-4">
            <Link href={requestHref} className={buttonVariants({ size: "lg" })}>
              Ask us to find it
            </Link>
            <Link href={waitlistHref} className={buttonVariants({ variant: "outline", size: "lg" })}>
              {t("waitlist.cta")}
            </Link>
            {fromCookie ? (
              <Link href={buildListingHref(basePath, { ...view, locality: "all" })} className={buttonVariants({ variant: "outline", size: "lg" })}>
                Search all areas
              </Link>
            ) : null}
            <Link href="/search" className={buttonVariants({ variant: "outline", size: "lg" })}>
              Clear search
            </Link>
          </div>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>No shops are listed yet</CardTitle>
            <CardDescription>NationX is onboarding local shops. Own a shop? Add it, or ask us to find something for you.</CardDescription>
          </CardHeader>
          <div className="flex flex-wrap gap-2 px-4 pb-4">
            <Link href="/merchant/apply" className={buttonVariants({ size: "lg" })}>
              Add your shop
            </Link>
            <Link href="/help-me-find-it" className={buttonVariants({ variant: "outline", size: "lg" })}>
              Help me find it
            </Link>
            <Link href={waitlistHref} className={buttonVariants({ variant: "outline", size: "lg" })}>
              {t("waitlist.cta")}
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}
