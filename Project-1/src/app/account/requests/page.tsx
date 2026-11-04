import type { Metadata } from "next";
import Link from "next/link";
import { StatusLine } from "@/components/help-request/status-line";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cancelHelpRequestAction } from "@/server/actions/help-request";
import { requireUser } from "@/server/auth/session";
import { listMyHelpRequests } from "@/server/services";
import { createRequestClient } from "@/server/supabase/server";

export const metadata: Metadata = { title: "My requests" };

const dateFormat = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });

export default async function MyRequestsPage() {
  const { user } = await requireUser("/account/requests");
  const requests = await listMyHelpRequests(await createRequestClient(), user.id);

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">My requests</h1>
        <Link href="/help-me-find-it" className={buttonVariants()}>
          New request
        </Link>
      </div>

      {requests.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No requests yet</CardTitle>
            <CardDescription>When you ask us to find something, you can follow it here.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="space-y-3">
          {requests.map((r) => {
            const slug = r.matched_shop?.storefront?.slug;
            return (
              <li key={r.id}>
                <Card>
                  <CardHeader>
                    <CardTitle>{r.item_name}</CardTitle>
                    <CardDescription>
                      <span className="font-mono">{r.tracking_id}</span> · {r.locality?.name ?? "—"} · {dateFormat.format(new Date(r.created_at))}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <StatusLine status={r.status} />
                    {r.resolution_notes ? <p className="text-sm text-muted-foreground">{r.resolution_notes}</p> : null}
                    {r.status === "matched" && slug ? (
                      <Link href={`/shop/${slug}`} className="text-sm underline underline-offset-4">
                        View {r.matched_shop?.name}
                      </Link>
                    ) : null}
                    {r.status === "pending" || r.status === "under_review" ? (
                      <form action={cancelHelpRequestAction}>
                        <input type="hidden" name="request_id" value={r.id} />
                        <Button type="submit" variant="ghost" size="sm">
                          Cancel this request
                        </Button>
                      </form>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
