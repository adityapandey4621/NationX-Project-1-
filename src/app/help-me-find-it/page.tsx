import type { Metadata } from "next";
import Link from "next/link";
import { HelpRequestForm } from "@/components/help-request/help-request-form";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { firstParam } from "@/lib/search-url";
import { getAuthContext } from "@/server/auth/session";
import { listActiveCategories, listActiveLocalities } from "@/server/services";
import { createRequestClient } from "@/server/supabase/server";

export const metadata: Metadata = { title: "Help me find it" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function HelpMeFindItPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ctx = await getAuthContext();

  let localities, categories;
  try {
    const db = await createRequestClient();
    [localities, categories] = await Promise.all([listActiveLocalities(db), listActiveCategories(db)]);
  } catch (e) {
    console.error("Help request page failed to load", e);
    return (
      <div className="mx-auto max-w-xl px-4 py-10">
        <Card role="alert">
          <CardHeader>
            <CardTitle>This page is unavailable right now</CardTitle>
            <CardDescription>Please try again in a moment.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 px-4 py-10">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Help me find it</h1>
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t find something in Khammam? Tell us what you need. Our team will look for a local shop and update this request. We
          never promise that something is in stock until a real shop has been confirmed.
        </p>
        <p className="text-sm">
          Already sent a request?{" "}
          <Link href={ctx ? "/account/requests" : "/help-me-find-it/track"} className="underline underline-offset-4">
            {ctx ? "See my requests" : "Check its status"}
          </Link>
        </p>
      </div>
      <HelpRequestForm
        localities={localities}
        categories={categories}
        signedIn={Boolean(ctx)}
        defaults={{
          item: firstParam(sp.item)?.slice(0, 200),
          locality_id: localities.find((l) => l.slug === firstParam(sp.locality))?.id,
          category_id: categories.find((c) => c.slug === firstParam(sp.category))?.id,
          name: ctx?.profile?.full_name,
          phone: ctx?.profile?.phone,
          email: ctx?.user.email ?? undefined,
        }}
      />
    </div>
  );
}
