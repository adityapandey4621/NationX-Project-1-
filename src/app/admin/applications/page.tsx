import type { Metadata } from "next";
import Link from "next/link";
import { StatusBadge, applicationStatusLabel } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/server/auth/session";
import { listApplicationsForAdmin } from "@/server/services";
import { createRequestClient } from "@/server/supabase/server";
import { APPLICATION_STATUSES, applicationStatusSchema } from "@/server/validation";

export const metadata: Metadata = { title: "Review queue" };

const dateFormat = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

export default async function AdminApplicationsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireRole("admin", "/admin/applications");
  const { status: rawStatus } = await searchParams;
  const parsed = applicationStatusSchema.safeParse(rawStatus ?? "submitted");
  const status = parsed.success && parsed.data !== "draft" ? parsed.data : "submitted";

  const db = await createRequestClient();
  const applications = await listApplicationsForAdmin(db, { status });

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Review queue</h1>
      <nav aria-label="Status filter" className="flex flex-wrap gap-2">
        {APPLICATION_STATUSES.filter((s) => s !== "draft").map((s) => (
          <Link
            key={s}
            href={`/admin/applications?status=${s}`}
            aria-current={s === status ? "page" : undefined}
            className={buttonVariants({ variant: s === status ? "default" : "outline", size: "sm" })}
          >
            {applicationStatusLabel(s)}
          </Link>
        ))}
      </nav>

      {applications.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nothing here</CardTitle>
            <CardDescription>No applications are {applicationStatusLabel(status).toLowerCase()} right now.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="space-y-3">
          {applications.map((a) => (
            <li key={a.id}>
              <Link href={`/admin/applications/${a.id}`} className="block">
                <Card className="transition-colors hover:bg-muted/50">
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle>{a.business_name}</CardTitle>
                      <StatusBadge status={a.status} />
                    </div>
                    <CardDescription>
                      {a.category?.name} · {a.locality?.name}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground">
                    {a.applicant?.full_name ?? "Unknown applicant"} · {a.contact_phone} · updated {dateFormat.format(new Date(a.updated_at))}
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
