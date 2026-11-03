import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { setWaitlistStatusAction } from "@/server/actions/waitlist";
import { requireRole } from "@/server/auth/session";
import { listWaitlistForStaff } from "@/server/services";
import { createRequestClient } from "@/server/supabase/server";

export const metadata: Metadata = { title: "Area waitlist" };

const dateFmt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });

/** Staff list of people who asked to be told when shops open in their area. Phone numbers are shown: staff only. */
export default async function AdminWaitlistPage() {
  await requireRole(["admin", "operator"], "/admin/waitlist");
  const entries = await listWaitlistForStaff(await createRequestClient());
  const waiting = entries.filter((e) => e.status === "waiting");
  const byArea = new Map<string, number>();
  for (const e of waiting) byArea.set(e.locality?.name ?? "—", (byArea.get(e.locality?.name ?? "—") ?? 0) + 1);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Area waitlist</h1>
        <p className="text-sm text-muted-foreground">
          People who agreed to be contacted when shops open in their area. Nothing is sent automatically: call or message them yourself, then mark them contacted. Handle these numbers
          as personal data and use them only for this purpose.
        </p>
      </div>

      {byArea.size > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Waiting per area">
          {[...byArea.entries()].sort((a, b) => b[1] - a[1]).map(([area, n]) => (
            <li key={area} className="rounded-full border bg-card px-3 py-1 text-sm shadow-card">
              {area}: <strong>{n}</strong>
            </li>
          ))}
        </ul>
      ) : null}

      {entries.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No one is waiting yet</CardTitle>
            <CardDescription>Entries appear here when someone joins from the &ldquo;Tell me when shops open&rdquo; page.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card shadow-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/50 text-xs text-muted-foreground uppercase">
              <tr>
                <th className="px-3 py-2">Area</th>
                <th className="px-3 py-2">Wants</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Phone</th>
                <th className="px-3 py-2">Joined</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="px-3 py-2 font-medium">{e.locality?.name ?? "—"}</td>
                  <td className="px-3 py-2">{e.category?.name ?? "Any"}</td>
                  <td className="px-3 py-2">{e.contact_name ?? "—"}</td>
                  <td className="px-3 py-2 font-mono">
                    <a href={`tel:${e.contact_phone}`} className="underline underline-offset-4">
                      {e.contact_phone}
                    </a>
                  </td>
                  <td className="px-3 py-2">{dateFmt.format(new Date(e.created_at))}</td>
                  <td className="px-3 py-2">
                    <form action={setWaitlistStatusAction} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={e.id} />
                      <input type="hidden" name="status" value={e.status === "waiting" ? "contacted" : "waiting"} />
                      <span className={e.status === "waiting" ? "font-medium" : "text-muted-foreground"}>{e.status === "waiting" ? "Waiting" : "Contacted"}</span>
                      <Button type="submit" variant="outline" size="sm">
                        {e.status === "waiting" ? "Mark contacted" : "Undo"}
                      </Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}