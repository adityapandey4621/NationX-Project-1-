import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { createCategoryAction, createLocalityAction, updateCategoryAction, updateLocalityAction } from "@/server/actions/admin-content";
import { requireRole } from "@/server/auth/session";
import { firstParam } from "@/lib/search-url";
import { listAllCategories, listAllLocalities } from "@/server/services";
import { createRequestClient } from "@/server/supabase/server";
import { STOREFRONT_TEMPLATES } from "@/server/validation";

export const metadata: Metadata = { title: "Categories and areas" };

const TEMPLATE_LABEL: Record<string, string> = { grocery: "Groceries and daily needs", standard_retail: "Standard shop", service_provider: "Service (appointments, quotes)", artisan: "Handmade / craft" };

export default async function AdminTaxonomyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("admin", "/admin/taxonomy");
  const sp = await searchParams;
  const db = await createRequestClient();
  const [categories, localities] = await Promise.all([listAllCategories(db), listAllLocalities(db)]);
  const ok = firstParam(sp.ok);
  const err = firstParam(sp.error);

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Categories and areas</h1>
        <p className="text-sm text-muted-foreground">
          A new category needs no code: pick the template that describes how its shops work and it appears everywhere. Turning one off hides it from customers and new applications; existing shops keep their page.
        </p>
      </div>
      {ok ? <p role="status" className="rounded-xl bg-success-soft px-4 py-2 text-sm text-success">{ok}</p> : null}
      {err ? <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-2 text-sm text-destructive">{err}</p> : null}

      <section aria-labelledby="c-h" className="space-y-4">
        <h2 id="c-h" className="text-lg font-semibold">Categories</h2>
        <ul className="space-y-2">
          {categories.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3">
              <div>
                <p className="font-medium">{c.name} {c.is_active ? null : <span className="text-xs text-muted-foreground">(off)</span>}</p>
                <p className="text-xs text-muted-foreground">/{c.slug} · {TEMPLATE_LABEL[c.default_template] ?? c.default_template} · order {c.display_order}</p>
              </div>
              <form action={updateCategoryAction}>
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="active" value={c.is_active ? "false" : "true"} />
                <Button type="submit" variant="outline" size="sm">{c.is_active ? "Turn off" : "Turn on"}</Button>
              </form>
            </li>
          ))}
        </ul>
        <form action={createCategoryAction} className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="name">New category name</Label><Input id="name" name="name" maxLength={60} required /></div>
          <div className="space-y-1.5"><Label htmlFor="slug">Web address (optional)</Label><Input id="slug" name="slug" placeholder="made-from-the-name" /></div>
          <div className="space-y-1.5"><Label htmlFor="default_template">How its shops work</Label>
            <NativeSelect id="default_template" name="default_template" defaultValue="standard_retail">{STOREFRONT_TEMPLATES.map((t) => <option key={t} value={t}>{TEMPLATE_LABEL[t] ?? t}</option>)}</NativeSelect></div>
          <div className="space-y-1.5"><Label htmlFor="display_order">Order</Label><Input id="display_order" name="display_order" type="number" min={0} defaultValue={100} /></div>
          <div><Button type="submit">Add category</Button></div>
        </form>
      </section>

      <section aria-labelledby="l-h" className="space-y-4">
        <h2 id="l-h" className="text-lg font-semibold">Areas</h2>
        <ul className="space-y-2">
          {localities.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3">
              <div><p className="font-medium">{l.name} {l.is_active ? null : <span className="text-xs text-muted-foreground">(off)</span>}</p><p className="text-xs text-muted-foreground">{l.district} · {l.pincode}</p></div>
              <form action={updateLocalityAction}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="active" value={l.is_active ? "false" : "true"} /><Button type="submit" variant="outline" size="sm">{l.is_active ? "Turn off" : "Turn on"}</Button></form>
            </li>
          ))}
        </ul>
        <form action={createLocalityAction} className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="l_name">New area name</Label><Input id="l_name" name="name" maxLength={80} required /></div>
          <div className="space-y-1.5"><Label htmlFor="l_district">City / district</Label><Input id="l_district" name="district" defaultValue="Khammam" required /></div>
          <div className="space-y-1.5"><Label htmlFor="l_pincode">PIN code</Label><Input id="l_pincode" name="pincode" inputMode="numeric" maxLength={6} placeholder="507001" required /></div>
          <div className="space-y-1.5"><Label htmlFor="l_slug">Web address (optional)</Label><Input id="l_slug" name="slug" /></div>
          <div><Button type="submit">Add area</Button></div>
        </form>
      </section>
    </div>
  );
}