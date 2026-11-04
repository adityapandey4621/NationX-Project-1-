import type { Metadata } from "next";
import Link from "next/link";
import { StatusLine } from "@/components/help-request/status-line";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HMF_STATUS_LABELS } from "@/lib/help-request-labels";
import { requireRole } from "@/server/auth/session";
import { listHelpRequestsForStaff } from "@/server/services";
import { createRequestClient } from "@/server/supabase/server";
import { hmfStatusSchema, HMF_STATUSES } from "@/server/validation";

export const metadata: Metadata = { title: "Help requests" };

const dateFormat = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

export default async function HelpRequestsQueue({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireRole(["admin", "operator"], "/admin/help-requests");
  const parsed = hmfStatusSchema.safeParse((await searchParams).status ?? "pending");
  const status = parsed.success ? parsed.data : "pending";
  const requests = await listHelpRequestsForStaff(await createRequestClient(), { status });

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Help Me Find It requests</h1>
      <nav aria-label="Status filter" className="flex flex-wrap gap-2">
        {HMF_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/help-requests?status=${s}`}
            aria-current={s === status ? "page" : undefined}
            className={buttonVariants({ variant: s === status ? "default" : "outline", size: "sm" })}
          >
            {HMF_STATUS_LABELS[s]}
          </Link>
        ))}
      </nav>

      {requests.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nothing here</CardTitle>
            <CardDescription>No requests are marked “{HMF_STATUS_LABELS[status]}”.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="space-y-3">
          {requests.map((r) => (
            <li key={r.id}>
              <Link href={`/admin/help-requests/${r.id}`} className="block">
                <Card className="transition-colors hover:bg-muted/50">
                  <CardHeader>
                    <CardTitle>{r.item_name}</CardTitle>
                    <CardDescription>
                      <span className="font-mono">{r.tracking_id}</span> · {r.locality?.name ?? "—"}
                      {r.category ? ` · ${r.category.name}` : ""}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1 text-xs text-muted-foreground">
                    <StatusLine status={r.status} />
                    <p>
                      {r.contact_name} · {dateFormat.format(new Date(r.created_at))}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
