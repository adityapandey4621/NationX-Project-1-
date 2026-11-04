import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { createCategoryAction, createLocalityAction, saveCategoryAttributeAction, saveSubcategoryAction, updateCategoryAction, updateLocalityAction } from "@/server/actions/admin-content";
import { requireRole } from "@/server/auth/session";
import { firstParam } from "@/lib/search-url";
import { listAllCategories, listAllCategoryAttributes, listAllLocalities, listAllSubcategories } from "@/server/services";
import { createRequestClient } from "@/server/supabase/server";
import { ATTRIBUTE_TYPES, STOREFRONT_TEMPLATES, type CategoryAttribute, type Subcategory } from "@/server/validation";

export const metadata: Metadata = { title: "Categories and areas" };

const TEMPLATE_LABEL: Record<string, string> = { grocery: "Groceries and daily needs", standard_retail: "Standard shop", service_provider: "Service (appointments, quotes)", artisan: "Handmade / craft" };
const TYPE_LABEL: Record<string, string> = { text: "Short text", number: "Number", choice: "Pick one from a list", yes_no: "Yes / No" };

function SubcategoryRows({ category, subs }: { category: { id: string; slug: string }; subs: Subcategory[] }) {
  return (
    <details className="mt-3 w-full rounded-lg border bg-background p-3">
      <summary className="cursor-pointer text-sm font-medium">Subcategories ({subs.filter((s) => s.is_active).length} on, {subs.length} in total)</summary>
      <p className="mt-2 text-xs text-muted-foreground">Shops pick one when they apply, customers can search by its name. The web address is set once and cannot change.</p>
      <ul className="mt-3 space-y-2">
        {subs.map((s) => (
          <li key={s.id}>
            <form action={saveSubcategoryAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={s.id} />
              <div className="space-y-1"><Label htmlFor={`sn-${s.id}`} className="text-xs">Name <span className="text-muted-foreground">(/{s.slug})</span></Label><Input id={`sn-${s.id}`} name="name" defaultValue={s.name} maxLength={60} required /></div>
              <div className="w-24 space-y-1"><Label htmlFor={`so-${s.id}`} className="text-xs">Order</Label><Input id={`so-${s.id}`} name="display_order" type="number" min={0} max={10000} defaultValue={s.display_order} /></div>
              <Button type="submit" name="active" value={s.is_active ? "true" : "false"} size="sm">Save</Button>
              <Button type="submit" name="active" value={s.is_active ? "false" : "true"} variant="outline" size="sm" aria-label={`${s.is_active ? "Turn off" : "Turn on"} ${s.name}`}>{s.is_active ? "Turn off" : "Turn on"}</Button>
              {s.is_active ? null : <span className="text-xs text-muted-foreground">(off)</span>}
            </form>
          </li>
        ))}
        {subs.length === 0 ? <li className="text-xs text-muted-foreground">None yet.</li> : null}
      </ul>
      <form action={saveSubcategoryAction} className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
        <input type="hidden" name="category_id" value={category.id} />
        <input type="hidden" name="category_slug" value={category.slug} />
        <div className="space-y-1"><Label htmlFor={`new-sn-${category.id}`} className="text-xs">New subcategory</Label><Input id={`new-sn-${category.id}`} name="name" maxLength={60} required placeholder="e.g. Rice and grains" /></div>
        <Button type="submit" size="sm">Add subcategory</Button>
      </form>
    </details>
  );
}

function QuestionRows({ category, questions }: { category: { id: string }; questions: CategoryAttribute[] }) {
  return (
    <details className="mt-3 w-full rounded-lg border bg-background p-3">
      <summary className="cursor-pointer text-sm font-medium">Questions for applicants ({questions.filter((q) => q.is_active).length} on)</summary>
      <p className="mt-2 text-xs text-muted-foreground">Extra questions shown on the application for this category (up to 20). The answers appear on the shop&apos;s page after approval. A question&apos;s short name and answer type cannot change once created.</p>
      <ul className="mt-3 space-y-3">
        {questions.map((q) => (
          <li key={q.id}>
            <form action={saveCategoryAttributeAction} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
              <input type="hidden" name="id" value={q.id} />
              <p className="text-xs text-muted-foreground sm:col-span-2">{TYPE_LABEL[q.field_type] ?? q.field_type} · short name <code>{q.key}</code> {q.is_active ? null : "· (off)"}</p>
              <div className="space-y-1"><Label htmlFor={`ql-${q.id}`} className="text-xs">Question</Label><Input id={`ql-${q.id}`} name="label" defaultValue={q.label} maxLength={80} required /></div>
              <div className="space-y-1"><Label htmlFor={`qh-${q.id}`} className="text-xs">Hint (optional)</Label><Input id={`qh-${q.id}`} name="help_text" defaultValue={q.help_text ?? ""} maxLength={200} /></div>
              {q.field_type === "choice" ? (
                <div className="space-y-1 sm:col-span-2"><Label htmlFor={`qo-${q.id}`} className="text-xs">Choices (one per line, 2 to 12)</Label><textarea id={`qo-${q.id}`} name="options" defaultValue={q.options.join("\n")} rows={4} className="w-full rounded-lg border bg-card px-3 py-2 text-sm" /></div>
              ) : null}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_required" defaultChecked={q.is_required} className="size-4" /> Must be answered to submit</label>
              <div className="w-24 space-y-1"><Label htmlFor={`qd-${q.id}`} className="text-xs">Order</Label><Input id={`qd-${q.id}`} name="display_order" type="number" min={0} max={10000} defaultValue={q.display_order} /></div>
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" name="active" value={q.is_active ? "true" : "false"} size="sm">Save</Button>
                <Button type="submit" name="active" value={q.is_active ? "false" : "true"} variant="outline" size="sm" aria-label={`${q.is_active ? "Turn off" : "Turn on"} question ${q.label}`}>{q.is_active ? "Turn off" : "Turn on"}</Button>
              </div>
            </form>
          </li>
        ))}
        {questions.length === 0 ? <li className="text-xs text-muted-foreground">No extra questions yet.</li> : null}
      </ul>
      <form action={saveCategoryAttributeAction} className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-2">
        <input type="hidden" name="category_id" value={category.id} />
        <div className="space-y-1"><Label htmlFor={`nq-l-${category.id}`} className="text-xs">New question</Label><Input id={`nq-l-${category.id}`} name="label" maxLength={80} required placeholder="e.g. Which brands do you stock?" /></div>
        <div className="space-y-1"><Label htmlFor={`nq-t-${category.id}`} className="text-xs">Kind of answer</Label>
          <NativeSelect id={`nq-t-${category.id}`} name="field_type" defaultValue="text">{ATTRIBUTE_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</NativeSelect></div>
        <div className="space-y-1"><Label htmlFor={`nq-k-${category.id}`} className="text-xs">Short name (optional)</Label><Input id={`nq-k-${category.id}`} name="key" placeholder="made_from_the_question" maxLength={40} /></div>
        <div className="space-y-1"><Label htmlFor={`nq-h-${category.id}`} className="text-xs">Hint (optional)</Label><Input id={`nq-h-${category.id}`} name="help_text" maxLength={200} /></div>
        <div className="space-y-1 sm:col-span-2"><Label htmlFor={`nq-o-${category.id}`} className="text-xs">Choices, only for &ldquo;Pick one from a list&rdquo; (one per line)</Label><textarea id={`nq-o-${category.id}`} name="options" rows={3} className="w-full rounded-lg border bg-card px-3 py-2 text-sm" /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_required" className="size-4" /> Must be answered to submit</label>
        <div><Button type="submit" size="sm">Add question</Button></div>
      </form>
    </details>
  );
}

export default async function AdminTaxonomyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("admin", "/admin/taxonomy");
  const sp = await searchParams;
  const db = await createRequestClient();
  const [categories, localities, subcategories, questions] = await Promise.all([listAllCategories(db), listAllLocalities(db), listAllSubcategories(db), listAllCategoryAttributes(db)]);
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
            <li key={c.id} className="rounded-xl border bg-card p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{c.name} {c.is_active ? null : <span className="text-xs text-muted-foreground">(off)</span>}</p>
                  <p className="text-xs text-muted-foreground">/{c.slug} · {TEMPLATE_LABEL[c.default_template] ?? c.default_template} · order {c.display_order}</p>
                </div>
                <form action={updateCategoryAction}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="active" value={c.is_active ? "false" : "true"} />
                  <Button type="submit" variant="outline" size="sm">{c.is_active ? "Turn off" : "Turn on"}</Button>
                </form>
              </div>
              <SubcategoryRows category={c} subs={subcategories.filter((s) => s.category_id === c.id)} />
              <QuestionRows category={c} questions={questions.filter((q) => q.category_id === c.id)} />
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