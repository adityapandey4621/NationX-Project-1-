import type { Metadata } from "next";
import Link from "next/link";
import { VisibilityForm } from "@/components/admin/visibility-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { firstParam } from "@/lib/search-url";
import { requireRole } from "@/server/auth/session";
import { listAllCategories, listAllLocalities, listStorefrontsForAdmin } from "@/server/services";
import { createRequestClient } from "@/server/supabase/server";
import { uuidSchema, VISIBILITY_STATUSES, visibilityStatusSchema } from "@/server/validation";

export const metadata: Metadata = { title: "Storefronts" };

const PAGE_SIZE = 25;
const dateFormat = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
const STATUS_LABELS = { visible: "Live", hidden: "Hidden", suspended: "Suspended" } as const;

type SearchParams = Record<string, string | string[] | undefined>;

export default async function AdminStorefrontsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireRole("admin", "/admin/storefronts");
  const params = await searchParams;
  const q = firstParam(params.q)?.slice(0, 80) ?? "";
  const status = visibilityStatusSchema.safeParse(firstParam(params.status));
  const page = Math.max(1, Number.parseInt(firstParam(params.page) ?? "1", 10) || 1);
  const locality = uuidSchema.safeParse(firstParam(params.locality));
  const category = uuidSchema.safeParse(firstParam(params.category));

  const db = await createRequestClient();
  const [localities, categories] = await Promise.all([listAllLocalities(db), listAllCategories(db)]);
  const { rows, total } = await listStorefrontsForAdmin(db, {
    q,
    ...(status.success ? { status: status.data } : {}),
    ...(locality.success ? { locality_id: locality.data } : {}),
    ...(category.success ? { category_id: category.data } : {}),
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (over: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    const next = { q: q || undefined, status: status.success ? status.data : undefined, locality: locality.success ? locality.data : undefined, category: category.success ? category.data : undefined, ...over };
    for (const [k, v] of Object.entries(next)) if (v) sp.set(k, v);
    const s = sp.toString();
    return `/admin/storefronts${s ? `?${s}` : ""}`;
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-10">
      <div className="space-y-1">
        <Link href="/admin" className="text-sm underline underline-offset-4">← Administration</Link>
        <h1 className="text-2xl font-semibold tracking-tight">Stores <span className="text-base font-normal text-muted-foreground">({total})</span></h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Hide or suspend a storefront to remove it from the public site and search. The merchant sees your reason. Every change is recorded in the audit log.
      </p>

      <form action="/admin/storefronts" className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="q">Shop name</Label>
          <Input id="q" name="q" defaultValue={q} maxLength={80} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="locality">Area</Label>
          <NativeSelect id="locality" name="locality" defaultValue={locality.success ? locality.data : ""}>
            <option value="">All areas</option>
            {localities.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="category">Category</Label>
          <NativeSelect id="category" name="category" defaultValue={category.success ? category.data : ""}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </NativeSelect>
        </div>
        {status.success ? <input type="hidden" name="status" value={status.data} /> : null}
        <Button type="submit">Filter</Button>
        {q || locality.success || category.success ? <Link href={href({ q: undefined, locality: undefined, category: undefined, page: undefined })} className={buttonVariants({ variant: "outline" })}>Clear</Link> : null}
      </form>

      <nav aria-label="Status filter" className="flex flex-wrap gap-2">
        <Link href={href({ status: undefined, page: undefined })} aria-current={!status.success ? "page" : undefined} className={buttonVariants({ variant: !status.success ? "default" : "outline", size: "sm" })}>
          All
        </Link>
        {VISIBILITY_STATUSES.map((s) => (
          <Link key={s} href={href({ status: s, page: undefined })} aria-current={status.success && status.data === s ? "page" : undefined} className={buttonVariants({ variant: status.success && status.data === s ? "default" : "outline", size: "sm" })}>
            {STATUS_LABELS[s]}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No storefronts</CardTitle>
            <CardDescription>{q || status.success || locality.success || category.success ? "Nothing matches these filters." : "Storefronts appear here once applications are approved."}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id}>
              <Card>
                <CardHeader>
                  <CardTitle>{r.shop.name}</CardTitle>
                  <CardDescription>
                    {r.shop.business?.name ?? "—"} · {r.shop.locality?.name ?? "—"} · {r.shop.category?.name ?? "—"} ·{" "}
                    <Link href={`/shop/${r.slug}`} className="underline underline-offset-4">
                      /shop/{r.slug}
                    </Link>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm">
                    <strong>{STATUS_LABELS[r.visibility_status]}</strong>
                    {r.visibility_status !== "visible" && r.visibility_changed_at
                      ? ` since ${dateFormat.format(new Date(r.visibility_changed_at))}`
                      : ""}
                    {r.visibility_reason ? <span className="text-muted-foreground"> · {r.visibility_reason}</span> : null}
                  </p>
                  <VisibilityForm storefrontId={r.id} slug={r.slug} current={r.visibility_status} />
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
          {page > 1 ? <Link href={href({ page: String(page - 1) })} className={buttonVariants({ variant: "outline", size: "sm" })}>← Previous</Link> : <span />}
          <span>
            Page {page} of {pages}
          </span>
          {page < pages ? <Link href={href({ page: String(page + 1) })} className={buttonVariants({ variant: "outline", size: "sm" })}>Next →</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}
