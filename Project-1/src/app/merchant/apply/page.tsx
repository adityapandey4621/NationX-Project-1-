import type { Metadata } from "next";
import { ApplicationForm } from "@/components/merchant/application-form";
import { requireUser } from "@/server/auth/session";
import { listActiveCategories, listActiveCategoryAttributes, listActiveLocalities, listAllActiveSubcategories } from "@/server/services";
import { createRequestClient } from "@/server/supabase/server";

export const metadata: Metadata = { title: "Add your shop" };

export default async function ApplyPage() {
  await requireUser("/merchant/apply");
  const db = await createRequestClient();
  const [localities, categories, subcategories, questions] = await Promise.all([
    listActiveLocalities(db),
    listActiveCategories(db),
    listAllActiveSubcategories(db),
    listActiveCategoryAttributes(db),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Add your shop</h1>
        <p className="text-sm text-muted-foreground">
          Tell us about your business. After NationX verifies it, your shop gets its own public page automatically.
        </p>
      </div>
      <ApplicationForm localities={localities} categories={categories} subcategories={subcategories} questions={questions} />
    </div>
  );
}
