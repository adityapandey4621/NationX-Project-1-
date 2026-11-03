import type { Metadata } from "next";
import { Suspense } from "react";
import { ResultsSkeleton } from "@/components/discovery/results-skeleton";
import { DiscoveryResults } from "@/components/discovery/discovery-results";
import { CategoryTile } from "@/components/marketplace/category-tile";
import { PageHeader } from "@/components/marketplace/page-header";
import { loadChrome } from "@/components/site/chrome-data";

type SearchParams = Record<string, string | string[] | undefined>;

export const metadata: Metadata = {
  title: "Explore local stores",
  description: "Browse verified local stores in Khammam by category and area.",
};

export default async function ExplorePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [{ categories }, params] = await Promise.all([loadChrome(), searchParams]);
  return (
    <>
      <PageHeader title="Explore local stores" description="Browse verified stores in Khammam. Filter by category or area, or search for a shop or item.">
        {categories.length > 0 ? (
          <ul className="scrollbar-none -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-4" aria-label="Categories">
            {categories.map((c) => (
              <li key={c.id} className="contents">
                <CategoryTile layout="rail" name={c.name} slug={c.slug} template={c.default_template} href={`/category/${c.slug}`} shopCount={c.shop_count} />
              </li>
            ))}
          </ul>
        ) : null}
      </PageHeader>
      <div className="mx-auto max-w-6xl px-4 py-8">
        <Suspense key={JSON.stringify(params)} fallback={<ResultsSkeleton />}>
          <DiscoveryResults basePath="/explore" searchParams={params} showProducts />
        </Suspense>
      </div>
    </>
  );
}
