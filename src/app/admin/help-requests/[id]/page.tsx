import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HelpRequestPanel } from "@/components/admin/help-request-panel";
import { StatusLine } from "@/components/help-request/status-line";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/server/auth/session";
import { getHelpRequestForStaff } from "@/server/services";
import { createRequestClient } from "@/server/supabase/server";
import { uuidSchema } from "@/server/validation";

export const metadata: Metadata = { title: "Help request" };

const dateFormat = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

export default async function HelpRequestDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) notFound();
  await requireRole(["admin", "operator"], `/admin/help-requests/${id}`);

  const r = await getHelpRequestForStaff(await createRequestClient(), parsed.data);
  if (!r) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <Link href="/admin/help-requests" className="text-sm underline underline-offset-4">
        ← All requests
      </Link>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{r.item_name}</h1>
        <p className="font-mono text-sm text-muted-foreground">{r.tracking_id}</p>
        <StatusLine status={r.status} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Request</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {r.item_description ? <p className="whitespace-pre-line">{r.item_description}</p> : <p className="text-muted-foreground">No extra details.</p>}
          <p className="text-muted-foreground">
            Area: {r.locality?.name ?? "—"} · Category: {r.category?.name ?? "not specified"} · Received {dateFormat.format(new Date(r.created_at))}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contact (private)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>{r.contact_name}</p>
          <p>
            <a href={`tel:${r.contact_phone}`} className="underline underline-offset-4">
              {r.contact_phone}
            </a>
          </p>
          {r.contact_email ? <p>{r.contact_email}</p> : null}
          <p className="text-xs text-muted-foreground">{r.customer_user_id ? "Signed-in customer" : "Guest request"}. Customer agreed to be contacted.</p>
        </CardContent>
      </Card>

      {r.matched_shop ? (
        <p className="text-sm">
          Matched shop:{" "}
          {r.matched_shop.storefront ? (
            <Link href={`/shop/${r.matched_shop.storefront.slug}`} className="underline underline-offset-4">
              {r.matched_shop.name}
            </Link>
          ) : (
            r.matched_shop.name
          )}
        </p>
      ) : null}
      {r.resolution_notes ? <p className="text-sm text-muted-foreground">Note: {r.resolution_notes}</p> : null}

      <section aria-labelledby="handle-h" className="space-y-3">
        <h2 id="handle-h" className="text-lg font-semibold">
          Handle this request
        </h2>
        <HelpRequestPanel requestId={r.id} currentStatus={r.status} />
      </section>
    </div>
  );
}
