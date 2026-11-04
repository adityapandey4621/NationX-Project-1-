import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { firstParam } from "@/lib/search-url";
import { changeRoleAction } from "@/server/actions/admin-team";
import { requireRole } from "@/server/auth/session";
import { listTeam } from "@/server/services";
import { createRequestClient } from "@/server/supabase/server";

export const metadata: Metadata = { title: "Team and access" };

const ROLE_LABEL: Record<string, string> = { admin: "Administrator", operator: "Operator" };
const dateFormat = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });

export default async function AdminTeamPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireRole("admin", "/admin/team");
  const sp = await searchParams;
  const team = await listTeam(await createRequestClient());
  const ok = firstParam(sp.ok);
  const err = firstParam(sp.error);

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <div className="space-y-1">
        <Link href="/admin" className="text-sm underline underline-offset-4">← Administration</Link>
        <h1 className="text-2xl font-semibold tracking-tight">Team and access</h1>
        <p className="text-sm text-muted-foreground">
          <strong>Administrators</strong> can do everything on this site, including approving shops and managing this team. <strong>Operators</strong> work the Help Me Find It queue and the area waitlist but cannot approve shops or change settings.
          The person must first create an ordinary account on the site; then enter the same e-mail address here. Every change is recorded in the audit log.
        </p>
      </div>
      {ok ? <p role="status" className="rounded-xl bg-success-soft px-4 py-2 text-sm text-success">{ok}</p> : null}
      {err ? <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-2 text-sm text-destructive">{err}</p> : null}

      <section aria-labelledby="t-h" className="space-y-3">
        <h2 id="t-h" className="text-lg font-semibold">Who has access</h2>
        <ul className="space-y-2">
          {team.map((m) => (
            <li key={m.user_id} className="rounded-xl border bg-card p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {m.full_name} {m.user_id === me.user.id ? <span className="text-xs text-muted-foreground">(you)</span> : null}
                    {m.is_active ? null : <span className="ml-2 text-xs text-destructive">account deactivated</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">{m.email ?? "no e-mail"} · since {dateFormat.format(new Date(m.since))}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {m.roles.map((role) => (
                    <form key={role} action={changeRoleAction} className="flex items-center gap-1.5">
                      <input type="hidden" name="email" value={m.email ?? ""} />
                      <input type="hidden" name="role" value={role} />
                      <input type="hidden" name="grant" value="false" />
                      <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">{ROLE_LABEL[role] ?? role}</span>
                      {m.email && !(role === "admin" && m.user_id === me.user.id) ? (
                        <Button type="submit" variant="outline" size="sm" aria-label={`Remove ${ROLE_LABEL[role] ?? role} access from ${m.full_name}`}>
                          Remove
                        </Button>
                      ) : null}
                    </form>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">You cannot remove your own administrator access, and the last administrator can never be removed.</p>
      </section>

      <section aria-labelledby="g-h" className="space-y-3">
        <h2 id="g-h" className="text-lg font-semibold">Give someone access</h2>
        <form action={changeRoleAction} className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2">
          <input type="hidden" name="grant" value="true" />
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="email">Their e-mail address (the one on their account)</Label>
            <Input id="email" name="email" type="email" required maxLength={254} autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role">Role</Label>
            <NativeSelect id="role" name="role" defaultValue="operator">
              <option value="operator">Operator</option>
              <option value="admin">Administrator</option>
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reason">Note (optional, kept in the audit log)</Label>
            <Input id="reason" name="reason" maxLength={500} />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit">Give access</Button>
          </div>
        </form>
      </section>
    </div>
  );
}
