import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DiscoveryResults } from "@/components/discovery/discovery-results";
import { PageHeader } from "@/components/marketplace/page-header";
import { findLocalityBySlug } from "@/server/services";
import { createRequestClient } from "@/server/supabase/server";

type SearchParams = Record<string, string | string[] | undefined>;

async function load(slug: string) {
  return findLocalityBySlug(await createRequestClient(), slug);
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const locality = await load((await params).slug);
  return locality ? { title: `Shops in ${locality.name}, ${locality.district}` } : { title: "Area not found", robots: { index: false } };
}

// No loading.tsx here on purpose: an unknown area must return a real HTTP 404.
export default async function LocalityPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const locality = await load((await params).slug);
  if (!locality) notFound();

  return (
    <>
      <PageHeader
        title={`Shops in ${locality.name}`}
        description={`Verified stores in ${locality.name}, ${locality.district}.`}
        trail={[{ label: "Explore", href: "/explore" }]}
      />
      <div className="mx-auto max-w-6xl px-4 py-8">
        <DiscoveryResults basePath={`/locality/${locality.slug}`} searchParams={await searchParams} fixedLocality={locality} />
      </div>
    </>
  );
}
