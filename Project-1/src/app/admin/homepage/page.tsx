import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { addFeaturedAction, createBannerAction, deleteBannerAction, removeFeaturedAction, setHomepageSectionAction, toggleBannerAction } from "@/server/actions/admin-content";
import { requireRole } from "@/server/auth/session";
import { HOME_SECTION_LABELS, resolveHomeLayout } from "@/lib/homepage-layout";
import { firstParam } from "@/lib/search-url";
import { listActiveLocalities, listBannersForAdmin, listFeaturedForAdmin, listHomepageSections, searchStorefronts } from "@/server/services";
import { createRequestClient } from "@/server/supabase/server";

export const metadata: Metadata = { title: "Homepage" };

export default async function AdminHomepagePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("admin", "/admin/homepage");
  const sp = await searchParams;
  const db = await createRequestClient();
  const [banners, featured, localities, shops, savedLayout] = await Promise.all([
    listBannersForAdmin(db),
    listFeaturedForAdmin(db),
    listActiveLocalities(db),
    searchStorefronts(db, { sort: "name", limit: 50 }),
    listHomepageSections(db),
  ]);
  const layout = resolveHomeLayout(savedLayout);
  const nameOf = new Map(shops.results.map((s) => [s.storefront_id, s.shop_name]));
  const areaOf = (id: string | null) => localities.find((l) => l.id === id)?.name ?? "All areas";
  const ok = firstParam(sp.ok);
  const err = firstParam(sp.error);

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Homepage</h1>
        <p className="text-sm text-muted-foreground">Banners and featured shops appear on the homepage straight away, with no redeploy. With nothing set, the homepage shows neither.</p>
      </div>
      {ok ? <p role="status" className="rounded-xl bg-success-soft px-4 py-2 text-sm text-success">{ok}</p> : null}
      {err ? <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-2 text-sm text-destructive">{err}</p> : null}

      <section aria-labelledby="s-h" className="space-y-4">
        <h2 id="s-h" className="text-lg font-semibold">Page sections</h2>
        <p className="text-sm text-muted-foreground">Choose which sections appear below the top banner and in what order (lowest number first). Hiding a section only hides it; a section with nothing to show stays empty either way.</p>
        <ul className="space-y-2">
          {layout.map((s) => (
            <li key={s.key} className="rounded-xl border bg-card p-3">
              <form action={setHomepageSectionAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="section_key" value={s.key} />
                <div className="min-w-40 flex-1">
                  <p className="font-medium">{HOME_SECTION_LABELS[s.key].label} {s.visible ? null : <span className="text-xs text-muted-foreground">(hidden)</span>}</p>
                  <p className="text-xs text-muted-foreground">{HOME_SECTION_LABELS[s.key].description}</p>
                </div>
                <div className="w-24 space-y-1"><Label htmlFor={`so-${s.key}`} className="text-xs">Order</Label><Input id={`so-${s.key}`} name="display_order" type="number" min={0} max={1000} defaultValue={s.order} /></div>
                <Button type="submit" name="visible" value={s.visible ? "true" : "false"} size="sm" aria-label={`Save order of ${HOME_SECTION_LABELS[s.key].label}`}>Save</Button>
                <Button type="submit" name="visible" value={s.visible ? "false" : "true"} variant="outline" size="sm" aria-label={`${s.visible ? "Hide" : "Show"} ${HOME_SECTION_LABELS[s.key].label}`}>{s.visible ? "Hide" : "Show"}</Button>
              </form>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="b-h" className="space-y-4">
        <h2 id="b-h" className="text-lg font-semibold">Banners</h2>
        <ul className="space-y-2">
          {banners.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3">
              <div>
                <p className="font-medium">{b.title} {b.is_active ? null : <span className="text-xs text-muted-foreground">(hidden)</span>}</p>
                <p className="text-xs text-muted-foreground">{areaOf(b.locality_id)} · order {b.display_order}{b.link_url ? ` · ${b.link_url}` : ""}</p>
              </div>
              <div className="flex gap-2">
                <form action={toggleBannerAction}>
                  <input type="hidden" name="id" value={b.id} />
                  <input type="hidden" name="active" value={b.is_active ? "false" : "true"} />
                  <Button type="submit" variant="outline" size="sm">{b.is_active ? "Hide" : "Show"}</Button>
                </form>
                <form action={deleteBannerAction}>
                  <input type="hidden" name="id" value={b.id} />
                  <Button type="submit" variant="outline" size="sm">Delete</Button>
                </form>
              </div>
            </li>
          ))}
          {banners.length === 0 ? <li className="text-sm text-muted-foreground">No banners yet.</li> : null}
        </ul>
        <form action={createBannerAction} className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="title">Title</Label><Input id="title" name="title" maxLength={80} required /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="body">Text (optional)</Label><Input id="body" name="body" maxLength={200} /></div>
          <div className="space-y-1.5"><Label htmlFor="link_url">Link (optional)</Label><Input id="link_url" name="link_url" placeholder="/explore or https://…" /></div>
          <div className="space-y-1.5"><Label htmlFor="b_locality">Area</Label>
            <NativeSelect id="b_locality" name="locality_id" defaultValue=""><option value="">All areas</option>{localities.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</NativeSelect></div>
          <div className="space-y-1.5"><Label htmlFor="display_order">Order (0 first)</Label><Input id="display_order" name="display_order" type="number" min={0} defaultValue={0} /></div>
          <div className="flex items-end"><Button type="submit">Add banner</Button></div>
        </form>
      </section>

      <section aria-labelledby="f-h" className="space-y-4">
        <h2 id="f-h" className="text-lg font-semibold">Featured shops</h2>
        <p className="text-sm text-muted-foreground">Only live shops are shown. Hiding or suspending a shop removes it from the homepage automatically.</p>
        <ul className="space-y-2">
          {featured.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 rounded-xl border bg-card p-3">
              <span>{nameOf.get(f.storefront_id) ?? "A shop that is not live right now"} <span className="text-xs text-muted-foreground">· {areaOf(f.locality_id)} · position {f.position}</span></span>
              <form action={removeFeaturedAction}><input type="hidden" name="id" value={f.id} /><Button type="submit" variant="outline" size="sm">Remove</Button></form>
            </li>
          ))}
          {featured.length === 0 ? <li className="text-sm text-muted-foreground">No featured shops yet.</li> : null}
        </ul>
        <form action={addFeaturedAction} className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="storefront_id">Shop</Label>
            <NativeSelect id="storefront_id" name="storefront_id" required defaultValue=""><option value="" disabled>Select a live shop</option>{shops.results.map((s) => <option key={s.storefront_id} value={s.storefront_id}>{s.shop_name} · {s.locality_name}</option>)}</NativeSelect></div>
          <div className="space-y-1.5"><Label htmlFor="f_locality">Show in</Label>
            <NativeSelect id="f_locality" name="locality_id" defaultValue=""><option value="">All areas</option>{localities.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</NativeSelect></div>
          <div className="space-y-1.5"><Label htmlFor="position">Position (0 first)</Label><Input id="position" name="position" type="number" min={0} defaultValue={0} /></div>
          <div><Button type="submit">Feature this shop</Button></div>
        </form>
      </section>
    </div>
  );
}