import type { Metadata } from "next";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/server/auth/session";
import { loadNotificationConfig } from "@/server/notifications/config";
import { getAdminOverview } from "@/server/services";
import { createRequestClient } from "@/server/supabase/server";
import { APPLICATION_STATUSES } from "@/server/validation";

export const metadata: Metadata = { title: "Admin" };

const dateFormat = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

function Stat({ label, value, href, hint }: { label: string; value: number; href?: string; hint?: string }) {
  const body = (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-2xl font-semibold tabular-nums">{value.toLocaleString("en-IN")}</p>
      <p className="text-sm text-muted-foreground">{label}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-xl outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50">
      {body}
    </Link>
  ) : (
    body
  );
}

export default async function AdminHomePage() {
  await requireRole("admin", "/admin");
  const o = await getAdminOverview(await createRequestClient());
  const cfg = loadNotificationConfig();
  const statuses = APPLICATION_STATUSES.filter((s) => s !== "draft");

  const openRequests = (o.help_requests.pending ?? 0) + (o.help_requests.under_review ?? 0);
  const failedMessages = o.notifications.failed ?? 0;
  const waitingMessages = (o.notifications.pending ?? 0) + (o.notifications.sending ?? 0);
  const attention: { label: string; value: number; href: string }[] = [
    { label: "applications waiting for a decision", value: o.applications.submitted ?? 0, href: "/admin/applications?status=submitted" },
    { label: "customer requests to follow up", value: openRequests, href: "/admin/help-requests" },
    { label: "people waiting for shops in their area", value: o.waitlist_waiting, href: "/admin/waitlist" },
  ].filter((a) => a.value > 0);

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Administration</h1>
        <p className="text-sm text-muted-foreground">As of {dateFormat.format(new Date(o.generated_at))}. Refresh the page for the latest numbers.</p>
      </div>

      <section aria-labelledby="att-h" className="space-y-3">
        <h2 id="att-h" className="text-lg font-semibold">Needs your attention</h2>
        {attention.length === 0 ? (
          <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Nothing is waiting. New applications, customer requests and area sign-ups will show up here.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {attention.map((a) => (
              <li key={a.label}>
                <Stat label={a.label} value={a.value} href={a.href} />
              </li>
            ))}
          </ul>
        )}
        {(o.applications.correction_requested ?? 0) > 0 ? (
          <p className="text-sm text-muted-foreground">{o.applications.correction_requested} application(s) are with applicants for corrections.</p>
        ) : null}
      </section>

      <section aria-labelledby="plat-h" className="space-y-3">
        <h2 id="plat-h" className="text-lg font-semibold">The platform right now</h2>
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <li><Stat label="Stores live" value={o.storefronts.live} href="/admin/storefronts?status=visible" /></li>
          <li><Stat label="Stores hidden" value={o.storefronts.hidden} href="/admin/storefronts?status=hidden" /></li>
          <li><Stat label="Stores suspended" value={o.storefronts.suspended} href="/admin/storefronts?status=suspended" /></li>
          <li><Stat label="Items listed" value={o.items.published} hint={o.items.total > o.items.published ? `${o.items.total - o.items.published} more are drafts` : undefined} /></li>
          <li><Stat label="Merchants" value={o.people.merchant ?? 0} /></li>
          <li><Stat label="Customer accounts" value={o.people.customer ?? 0} /></li>
          <li><Stat label="Administrators" value={o.people.admin ?? 0} href="/admin/team" /></li>
          <li><Stat label="Operators" value={o.people.operator ?? 0} href="/admin/team" /></li>
        </ul>
      </section>

      <section aria-labelledby="area-h" className="space-y-3">
        <h2 id="area-h" className="text-lg font-semibold">Stores by area</h2>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <caption className="sr-only">Number of stores and items in each area</caption>
            <thead className="border-b text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Area</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Live</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Hidden</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Suspended</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Items</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Waiting</th>
              </tr>
            </thead>
            <tbody>
              {o.by_area.map((a) => (
                <tr key={a.id} className="border-b last:border-0">
                  <th scope="row" className="px-3 py-2 font-medium">
                    <Link href={`/admin/storefronts?locality=${a.id}`} className="underline underline-offset-4">{a.name}</Link>
                    {a.is_active ? null : <span className="ml-2 text-xs font-normal text-muted-foreground">(off)</span>}
                    {a.live + a.hidden + a.suspended === 0 ? <span className="ml-2 text-xs font-normal text-muted-foreground">no stores yet</span> : null}
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums">{a.live}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{a.hidden}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{a.suspended}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{a.items}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{a.waiting}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">&ldquo;Waiting&rdquo; is people who asked to be told when a shop opens in that area. Click an area to see its stores.</p>
      </section>

      <section aria-labelledby="cat-h" className="space-y-3">
        <h2 id="cat-h" className="text-lg font-semibold">Stores by category</h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {o.by_category.map((c) => (
            <li key={c.id}>
              <Link href={`/admin/storefronts?category=${c.id}`} className="flex items-center justify-between rounded-xl border bg-card px-3 py-2 text-sm hover:bg-muted">
                <span>{c.name}{c.is_active ? "" : " (off)"}</span>
                <span className="tabular-nums text-muted-foreground">{c.live} live{c.not_visible ? ` · ${c.not_visible} not visible` : ""}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="app-h" className="space-y-3">
        <h2 id="app-h" className="text-lg font-semibold">Applications</h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {statuses.map((s) => (
            <li key={s}>
              <Link href={`/admin/applications?status=${s}`} className="flex items-center justify-between rounded-lg border bg-card p-3 hover:bg-muted">
                <StatusBadge status={s} />
                <span className="text-lg font-semibold tabular-nums">{o.applications[s] ?? 0}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="msg-h" className="space-y-2">
        <h2 id="msg-h" className="text-lg font-semibold">Messages to shopkeepers and customers</h2>
        <p className="rounded-xl border bg-card p-4 text-sm">
          E-mail: <strong>{cfg.email ? `connected (${cfg.email.provider})` : "not connected"}</strong> · SMS: <strong>{cfg.sms ? "connected" : "not connected"}</strong>
          {" · "}waiting to send: <strong>{waitingMessages}</strong> · failed: <strong>{failedMessages}</strong>
          {!cfg.email && !cfg.sms ? <span className="mt-1 block text-muted-foreground">Nothing is sent until an e-mail or SMS service is connected. People still see every update in the app. See docs/NOTIFICATIONS.md.</span> : null}
          {cfg.problems.length ? <span className="mt-1 block text-destructive">{cfg.problems.join(". ")}.</span> : null}
        </p>
      </section>

      <section aria-labelledby="tools-h" className="space-y-3">
        <h2 id="tools-h" className="text-lg font-semibold">Tools</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {[
            ["/admin/applications", "Merchant applications", "Review, request corrections, approve or reject"],
            ["/admin/storefronts", "All stores", "Search by name, area or category; hide, suspend or reactivate"],
            ["/admin/help-requests", "Help Me Find It", "Customer requests for things they cannot find"],
            ["/admin/waitlist", "Area waitlist", "People waiting for shops to open in their area"],
            ["/admin/homepage", "Homepage", "Banners and featured shops"],
            ["/admin/taxonomy", "Categories and areas", "Add or turn off categories and areas"],
            ["/admin/search", "Search words", "Make different spellings and Telugu words find the same shops"],
            ["/admin/modules", "Modules", "Switch future products on or off, per area"],
            ["/admin/team", "Team and access", "Give or remove administrator and operator access"],
          ].map(([href, title, desc]) => (
            <li key={href}>
              <Link href={href as string} className="block rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                <Card className="h-full hover:bg-muted">
                  <CardHeader>
                    <CardTitle>{title}</CardTitle>
                    <CardDescription>{desc}</CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
