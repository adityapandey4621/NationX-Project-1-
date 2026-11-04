import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApplicationForm } from "@/components/merchant/application-form";
import { ApplicationSummary, fileLabel, type SignedFile } from "@/components/merchant/application-summary";
import { FileUploader } from "@/components/merchant/file-uploader";
import { StatusBadge } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { deleteDraftAction, uploadApplicationFileAction } from "@/server/actions/merchant";
import { requireUser } from "@/server/auth/session";
import {
  getMyApplication,
  isEditableStatus,
  listActiveCategories,
  listActiveCategoryAttributes,
  listActiveLocalities,
  listAllActiveSubcategories,
  listMyBusinesses,
  signPrivateFiles,
} from "@/server/services";
import { createRequestClient } from "@/server/supabase/server";
import { uuidSchema } from "@/server/validation";

export const metadata: Metadata = { title: "Application" };

export default async function ApplicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; submitted?: string }>;
}) {
  const { id } = await params;
  const flags = await searchParams;
  const parsedId = uuidSchema.safeParse(id);
  if (!parsedId.success) notFound();

  const { user } = await requireUser(`/merchant/applications/${id}`);
  const db = await createRequestClient();
  const app = await getMyApplication(db, user.id, parsedId.data);
  if (!app) notFound(); // also covers other people's applications

  const editable = isEditableStatus(app.status);
  const paths = [
    ...(app.logo_storage_path ? [app.logo_storage_path] : []),
    ...(app.photos_storage_paths ?? []),
    ...(app.document_storage_paths ?? []),
  ];
  const signed = await signPrivateFiles(db, paths);
  const files: SignedFile[] = paths.map((path, i) => ({
    path,
    url: signed.find((s) => s.path === path)?.url ?? null,
    label: fileLabel(path, i),
  }));

  const [localities, categories, subcategories, questions] = editable
    ? await Promise.all([listActiveLocalities(db), listActiveCategories(db), listAllActiveSubcategories(db), listActiveCategoryAttributes(db)])
    : [[], [], [], []];

  let storefrontSlug: string | null = null;
  let shopId: string | null = null;
  if (app.status === "approved" && app.associated_business_id) {
    const shop = (await listMyBusinesses(db, user.id))
      .find((b) => b.business.id === app.associated_business_id)
      ?.business.shops.find((s) => s.shop_code === "MAIN");
    storefrontSlug = shop?.storefront?.slug ?? null;
    shopId = shop?.id ?? null;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{app.business_name}</h1>
        <StatusBadge status={app.status} />
      </div>

      {flags.submitted ? (
        <p role="status" className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          Submitted! NationX will review your application. You can follow its status here.
        </p>
      ) : null}
      {flags.saved ? (
        <p role="status" className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          Draft saved. You can now add your logo, photos and documents below.
        </p>
      ) : null}

      {app.status === "correction_requested" && app.correction_notes ? (
        <Card>
          <CardHeader>
            <CardTitle>Changes requested</CardTitle>
            <CardDescription>Please update your application and submit it again.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">{app.correction_notes}</CardContent>
        </Card>
      ) : null}
      {app.status === "rejected" ? (
        <Card>
          <CardHeader>
            <CardTitle>Not approved</CardTitle>
            <CardDescription>You may submit a new application if your situation changes.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">{app.rejection_reason}</CardContent>
        </Card>
      ) : null}
      {app.status === "submitted" ? (
        <p className="text-sm text-muted-foreground">Your application is under review. You&apos;ll see the result here.</p>
      ) : null}
      {app.status === "approved" ? (
        <Card>
          <CardHeader>
            <CardTitle>Your shop is live 🎉</CardTitle>
            <CardDescription>Your public page was created automatically.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3 text-sm">
            {storefrontSlug ? (
              <>
                <span className="break-all">/shop/{storefrontSlug}</span>
                <Link href={`/shop/${storefrontSlug}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  View public page
                </Link>
              </>
            ) : null}
            {shopId ? (
              <Link href={`/merchant/shops/${shopId}`} className={buttonVariants({ size: "sm" })}>
                Manage shop
              </Link>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {editable ? (
        <>
          <ApplicationForm localities={localities} categories={categories} subcategories={subcategories} questions={questions} application={app} />
          <Card>
            <CardHeader>
              <CardTitle>Logo, photos & documents</CardTitle>
              <CardDescription>
                Stored privately — only you and NationX reviewers can see them. Photos and logo: JPEG, PNG or WebP up to 5 MB.
                Documents (e.g. trade licence): PDF or image up to 10 MB.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <ApplicationSummary application={app} files={files} removableApplicationId={app.id} />
              <FileUploader action={uploadApplicationFileAction} label="Logo" kind="logo" accept="image/jpeg,image/png,image/webp" hidden={{ application_id: app.id }} />
              <FileUploader action={uploadApplicationFileAction} label="Shop photo (front, inside)" kind="photo" accept="image/jpeg,image/png,image/webp" hidden={{ application_id: app.id }} />
              <FileUploader action={uploadApplicationFileAction} label="Document (optional)" kind="document" accept="image/jpeg,image/png,image/webp,application/pdf" hidden={{ application_id: app.id }} />
            </CardContent>
          </Card>
          {app.status === "draft" ? (
            <form action={deleteDraftAction}>
              <input type="hidden" name="application_id" value={app.id} />
              <Button type="submit" variant="destructive" size="sm">
                Delete this draft
              </Button>
            </form>
          ) : null}
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Application details</CardTitle>
          </CardHeader>
          <CardContent>
            <ApplicationSummary application={app} files={files} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
