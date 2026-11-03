import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { WaitlistForm } from "@/components/waitlist/waitlist-form";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getT } from "@/i18n/server";
import { firstParam } from "@/lib/search-url";
import { isSupabaseConfigured } from "@/server/config/env";
import { listActiveCategories, listActiveLocalities } from "@/server/services";
import { createRequestClient } from "@/server/supabase/server";

export const metadata: Metadata = { title: "Tell me when shops open", description: "Leave your number and we will contact you when shops open in your area." };

export default async function WaitlistPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [sp, t] = await Promise.all([searchParams, getT()]);
  let localities, categories;
  try {
    if (!isSupabaseConfigured()) throw new Error("not configured");
    const db = await createRequestClient();
    [localities, categories] = await Promise.all([listActiveLocalities(db), listActiveCategories(db)]);
  } catch (e) {
    unstable_rethrow(e);
    console.error("Waitlist page failed to load", e);
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
  const preselected = localities.find((l) => l.slug === firstParam(sp.locality));

  return (
    <div className="mx-auto max-w-xl space-y-6 px-4 py-10">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("waitlist.title")}</h1>
        <p className="text-foreground/75">{t("waitlist.intro")}</p>
      </div>
      <WaitlistForm
        localities={localities}
        categories={categories}
        defaultLocalityId={preselected?.id}
        labels={{
          area: t("waitlist.area"),
          areaSelect: t("waitlist.areaSelect"),
          category: t("waitlist.category"),
          categoryAny: t("waitlist.categoryAny"),
          name: t("waitlist.name"),
          phone: t("waitlist.phone"),
          consent: t("waitlist.consent"),
          submit: t("waitlist.submit"),
          sending: t("waitlist.sending"),
          joinedTitle: t("waitlist.joinedTitle"),
          joinedBody: t("waitlist.joinedBody"),
          already: t("waitlist.already"),
          leaveTitle: t("waitlist.leaveTitle"),
          leaveBody: t("waitlist.leaveBody"),
          leave: t("waitlist.leave"),
          left: t("waitlist.left"),
        }}
      />
    </div>
  );
}