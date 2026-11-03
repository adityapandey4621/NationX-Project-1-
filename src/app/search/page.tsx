import type { Metadata } from "next";
import { Suspense } from "react";
import { ResultsSkeleton } from "@/components/discovery/results-skeleton";
import { DiscoveryResults } from "@/components/discovery/discovery-results";
import { PageHeader } from "@/components/marketplace/page-header";
import { firstParam } from "@/lib/search-url";

type SearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<Metadata> {
  const q = firstParam((await searchParams).q);
  // Result pages with arbitrary queries should not be indexed.
  return { title: q ? `“${q.slice(0, 40)}” – Search` : "Find shops", robots: { index: !q, follow: true } };
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const q = firstParam(params.q);
  return (
    <>
      <PageHeader
        title={q ? `Results for “${q.slice(0, 60)}”` : "Find shops in Khammam"}
        description={q ? undefined : "Search by shop name, item, category or area."}
        trail={[{ label: "Explore", href: "/explore" }]}
      />
      <div className="mx-auto max-w-6xl px-4 py-8">
        <Suspense key={JSON.stringify(params)} fallback={<ResultsSkeleton />}>
          <DiscoveryResults basePath="/search" searchParams={params} showProducts />
        </Suspense>
      </div>
    </>
  );
}
