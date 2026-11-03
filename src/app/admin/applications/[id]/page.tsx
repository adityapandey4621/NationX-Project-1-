import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DecisionPanel } from "@/components/admin/decision-panel";
import { ApplicationSummary, fileLabel, type SignedFile } from "@/components/merchant/application-summary";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/server/auth/session";
import { getApplicationForAdmin, getBusinessStorefrontSlug, signPrivateFiles } from "@/server/services";
import { createRequestClient } from "@/server/supabase/server";
import { uuidSchema } from "@/server/validation";

export const metadata: Metadata = { title: "Review application" };

const dateFormat = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

const ACTION_LABELS: Record<string, string> = {
  "application.submitted": "Submitted by applicant",
  "application.approved": "Approved — storefront published",
  "application.rejected": "Rejected",
  "application.corrections_requested": "Corrections requested",
};

export default async function AdminApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) notFound();
  await requireRole("admin", `/admin/applications/${id}`);

  const db = await createRequestClient();
  const detail = await getApplicationForAdmin(db, parsed.data);
  if (!detail) notFound();
  const { application: a, history, duplicates } = detail;

  const paths = [
    ...(a.logo_storage_path ? [a.logo_storage_path] : []),
    ...(a.photos_storage_paths ?? []),
    ...(a.document_storage_paths ?? []),
  ];
  const signed = await signPrivateFiles(db, paths);
  const files: SignedFile[] = paths.map((path, i) => ({
    path,
    url: signed.find((s) => s.path === path)?.url ?? null,
    label: fileLabel(path, i),
  }));
  const slug = a.status === "approved" && a.associated_business_id ? await getBusinessStorefrontSlug(db, a.associated_business_id) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <Link href="/admin/applications" className="text-sm underline underline-offset-4">
        ← Review queue
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{a.business_name}</h1>
        <StatusBadge status={a.status} />
      </div>

      {slug ? (
        <Link href={`/shop/${slug}`} className={buttonVariants({ variant: "outline" })}>
          Open storefront /shop/{slug}
        </Link>
      ) : null}

      {duplicates.length > 0 ? (
        <Card className="border-amber-500/50">
          <CardHeader>
            <CardTitle>Possible duplicates</CardTitle>
            <CardDescription>Check these before approving so the same shop isn&apos;t listed twice.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {duplicates.map((d) => (
                <li key={`${d.kind}-${d.id}`}>
                  {d.kind === "application" ? (
                    <Link href={`/admin/applications/${d.id}`} className="underline underline-offset-4">
                      {d.label}
                    </Link>
                  ) : (
                    d.label
                  )}{" "}
                  <span className="text-muted-foreground">
                    ({d.kind}, {d.detail}) — {d.reason === "same_phone" ? "same phone number" : "same address"}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Applicant</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {a.applicant ? `${a.applicant.full_name} · ${a.applicant.phone} · ${a.applicant.email ?? "no email"}` : "Unknown"}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Application</CardTitle>
        </CardHeader>
        <CardContent>
          <ApplicationSummary application={a} files={files} />
        </CardContent>
      </Card>

      {a.status === "submitted" ? (
        <section aria-labelledby="decision-h" className="space-y-3">
          <h2 id="decision-h" className="text-lg font-semibold">
            Decision
          </h2>
          <DecisionPanel applicationId={a.id} />
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">Only submitted applications can be decided.</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recorded events.</p>
          ) : (
            <ol className="space-y-2 text-sm">
              {history.map((h) => (
                <li key={h.id}>
                  <span className="font-medium">{ACTION_LABELS[h.action] ?? h.action}</span>{" "}
                  <span className="text-muted-foreground">· {dateFormat.format(new Date(h.created_at))}</span>
                  {h.reason ? <p className="text-muted-foreground">“{h.reason}”</p> : null}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
