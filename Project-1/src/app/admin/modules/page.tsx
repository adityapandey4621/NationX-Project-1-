import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { firstParam } from "@/lib/search-url";
import { setModuleAction } from "@/server/actions/admin-search";
import { requireRole } from "@/server/auth/session";
import { listAllLocalities, listModuleFlags } from "@/server/services";
import { createRequestClient } from "@/server/supabase/server";

export const metadata: Metadata = { title: "Modules" };

export default async function AdminModulesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("admin", "/admin/modules");
  const sp = await searchParams;
  const db = await createRequestClient();
  const [flags, areas] = await Promise.all([listModuleFlags(db), listAllLocalities(db)]);
  const ok = firstParam(sp.ok);
  const err = firstParam(sp.error);

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <div className="space-y-1">
        <Link href="/admin" className="text-sm underline underline-offset-4">← Administration</Link>
        <h1 className="text-2xl font-semibold tracking-tight">Modules</h1>
        <p className="text-sm text-muted-foreground">
          Future products (such as grocery ordering) are switched on here, for the whole platform or for chosen areas only. A module that is off is invisible to customers and its pages do not exist.
          <strong> Nothing below is built yet</strong>: turning a switch on today changes nothing customers can see. Every change is recorded in the audit log.
        </p>
      </div>
      {ok ? <p role="status" className="rounded-xl bg-success-soft px-4 py-2 text-sm text-success">{ok}</p> : null}
      {err ? <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-2 text-sm text-destructive">{err}</p> : null}

      {flags.length === 0 ? <p className="text-sm text-muted-foreground">No modules are registered.</p> : null}
      <ul className="space-y-4">
        {flags.map((f) => (
          <li key={f.key} className="rounded-xl border bg-card p-4">
            <form action={setModuleAction} className="space-y-3">
              <input type="hidden" name="key" value={f.key} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-semibold">{f.key}</h2>
                  {f.description ? <p className="text-xs text-muted-foreground">{f.description}</p> : null}
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${f.is_enabled ? "bg-success-soft text-success" : "bg-muted"}`}>
                  {f.is_enabled ? (f.enabled_localities.length > 0 ? `On in ${f.enabled_localities.length} area${f.enabled_localities.length === 1 ? "" : "s"}` : "On everywhere") : "Off"}
                </span>
              </div>
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium">Where it is on (leave all unticked for every area)</legend>
                <div className="grid gap-1 sm:grid-cols-2">
                  {areas.map((a) => (
                    <label key={a.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="localities" value={a.id} defaultChecked={f.enabled_localities.includes(a.id)} className="size-4" />
                      {a.name}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="space-y-1.5">
                <Label htmlFor={`r-${f.key}`}>Note (optional, kept in the audit log)</Label>
                <Input id={`r-${f.key}`} name="reason" maxLength={500} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" name="enabled" value="true">{f.is_enabled ? "Save areas" : "Turn on"}</Button>
                {f.is_enabled ? <Button type="submit" name="enabled" value="false" variant="outline">Turn off</Button> : null}
              </div>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
