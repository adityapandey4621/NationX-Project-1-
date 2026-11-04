import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DiscoveryResults } from "@/components/discovery/discovery-results";
import { CategoryIcon } from "@/components/marketplace/category-icon";
import { PageHeader } from "@/components/marketplace/page-header";
import { loadChrome } from "@/components/site/chrome-data";
import Link from "next/link";
import { findCategoryBySlug, listActiveSubcategories } from "@/server/services";
import { createRequestClient } from "@/server/supabase/server";

type SearchParams = Record<string, string | string[] | undefined>;

async function load(slug: string) {
  return findCategoryBySlug(await createRequestClient(), slug);
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const category = await load((await params).slug);
  return category ? { title: `${category.name} shops in Khammam` } : { title: "Category not found", robots: { index: false } };
}

// No loading.tsx here on purpose: an unknown category must return a real HTTP 404.
export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const category = await load((await params).slug);
  if (!category) notFound();
  const { categories } = await loadChrome();
  const template = categories.find((c) => c.id === category.id)?.default_template;
  const sp = await searchParams;
  const activeQuery = typeof sp.q === "string" ? sp.q : "";
  // Subcategory shortcuts. A failure here only hides the shortcuts; the category page still works.
  const subcategories = await listActiveSubcategories(await createRequestClient(), category.id).catch((e: unknown) => {
    console.error("Subcategories failed", e);
    return [];
  });

  return (
    <>
      <PageHeader
        title={`${category.name} shops`}
        description={`Verified ${category.name.toLowerCase()} stores in Khammam.`}
        trail={[{ label: "Explore", href: "/explore" }]}
        icon={<CategoryIcon slug={category.slug} template={template} className="size-14 rounded-2xl" iconClassName="size-7" />}
      />
      <div className="mx-auto max-w-6xl px-4 py-8">
        {subcategories.length > 0 ? (
          <nav aria-label={`${category.name} subcategories`} className="mb-6 flex flex-wrap gap-2">
            {subcategories.map((s) => {
              const selected = activeQuery.toLowerCase() === s.name.toLowerCase();
              return (
                <Link
                  key={s.id}
                  href={selected ? `/category/${category.slug}` : `/category/${category.slug}?q=${encodeURIComponent(s.name)}`}
                  aria-current={selected ? "true" : undefined}
                  className={`rounded-full border px-3 py-1 text-sm ${selected ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}
                >
                  {s.name}
                </Link>
              );
            })}
          </nav>
        ) : null}
        <DiscoveryResults basePath={`/category/${category.slug}`} searchParams={sp} fixedCategory={category} />
      </div>
    </>
  );
}
