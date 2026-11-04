import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { firstParam } from "@/lib/search-url";
import { addAliasAction, removeAliasAction } from "@/server/actions/admin-search";
import { requireRole } from "@/server/auth/session";
import { listSearchAliases } from "@/server/services";
import { createRequestClient } from "@/server/supabase/server";

export const metadata: Metadata = { title: "Search words" };

export default async function AdminSearchAliasesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("admin", "/admin/search");
  const sp = await searchParams;
  const aliases = await listSearchAliases(await createRequestClient());
  const ok = firstParam(sp.ok);
  const err = firstParam(sp.error);

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <div className="space-y-1">
        <Link href="/admin" className="text-sm underline underline-offset-4">← Administration</Link>
        <h1 className="text-2xl font-semibold tracking-tight">Search words</h1>
        <p className="text-sm text-muted-foreground">
          Customers spell the same name in different ways (<em>Lakshmi</em> / <em>Laxmi</em>) and may type in Telugu or English. Link two words here and a search for either one finds the same shops.
          It applies to shop names, categories, areas and item names that contain the first word. Existing shops are updated immediately.
        </p>
      </div>
      {ok ? <p role="status" className="rounded-xl bg-success-soft px-4 py-2 text-sm text-success">{ok}</p> : null}
      {err ? <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-2 text-sm text-destructive">{err}</p> : null}

      <section aria-labelledby="add-h" className="space-y-3">
        <h2 id="add-h" className="text-lg font-semibold">Link two words</h2>
        <form action={addAliasAction} className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="term">A word that appears in shop data</Label>
            <Input id="term" name="term" required minLength={2} maxLength={60} placeholder="lakshmi" autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="alias">Another way customers write it</Label>
            <Input id="alias" name="alias" required minLength={2} maxLength={60} placeholder="laxmi" autoComplete="off" />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="both" defaultChecked className="size-4" />
            Also link them the other way round (recommended)
          </label>
          <div className="sm:col-span-2">
            <Button type="submit">Save link</Button>
          </div>
        </form>
        <p className="text-xs text-muted-foreground">
          Words are matched as part of the shop text, so keep them specific: linking a very short word can make unrelated shops appear.
          The starter Telugu words were written without a native-speaker review; please correct any that look wrong.
        </p>
      </section>

      <section aria-labelledby="list-h" className="space-y-3">
        <h2 id="list-h" className="text-lg font-semibold">Current links ({aliases.length})</h2>
        {aliases.length === 0 ? (
          <p className="text-sm text-muted-foreground">No links yet.</p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {aliases.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span>
                  <span lang="te" className="font-medium">{a.term}</span> <span aria-hidden="true">→</span><span className="sr-only"> also finds </span>{" "}
                  <span lang="te" className="font-medium">{a.alias}</span>
                </span>
                <form action={removeAliasAction}>
                  <input type="hidden" name="id" value={a.id} />
                  <Button type="submit" variant="outline" size="sm" aria-label={`Remove link ${a.term} to ${a.alias}`}>Remove</Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
