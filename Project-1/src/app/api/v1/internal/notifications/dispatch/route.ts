import { isSupabaseConfigured } from "@/server/config/env";
import { errorResponse, handleRouteError, ok } from "@/server/http";
import { isAuthorizedScheduler } from "@/server/notifications/authorize";
import { loadNotificationConfig } from "@/server/notifications/config";
import { dispatchNotifications } from "@/server/notifications/dispatch";
import { buildProviders } from "@/server/notifications/providers";
import { createAdminClient } from "@/server/supabase/admin";
import { eventRetentionDays } from "@/server/notifications/retention";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET|POST /api/v1/internal/notifications/dispatch — called by a scheduler every few minutes (Vercel Cron,
 * GitHub Actions, cron-job.org ...), never by browsers. Authenticated with `Authorization: Bearer $CRON_SECRET`
 * (Vercel Cron sends this header automatically when CRON_SECRET is set). Safe to call concurrently and often.
 *
 * Sends queued e-mail/SMS through whichever providers are configured (see docs/NOTIFICATIONS.md), then removes
 * finished messages older than 30 days. The response has counts only: no recipients, no message text.
 */
async function run(request: Request) {
  try {
    if (!process.env.CRON_SECRET) return errorResponse("INTERNAL_ERROR", "Notifications are not configured (CRON_SECRET is not set)", { status: 503 });
    if (!isAuthorizedScheduler(request.headers.get("authorization"), process.env.CRON_SECRET)) {
      const res = errorResponse("UNAUTHENTICATED", "A valid scheduler secret is required");
      res.headers.set("WWW-Authenticate", 'Bearer realm="nationx-scheduler"');
      return res;
    }
    if (!isSupabaseConfigured()) return errorResponse("INTERNAL_ERROR", "Service is not configured", { status: 503 });

    const config = loadNotificationConfig();
    const providers = buildProviders(config);
    const db = createAdminClient();

    const dispatched = await dispatchNotifications(db, providers, { appUrl: config.appUrl });
    const { data: purged } = await db.rpc("purge_old_notifications", { p_days: 30 });
    // Integration-event retention (migration 019). The database never keeps less than 7 days whatever is asked.
    const { data: eventsPurged } = await db.rpc("purge_event_outbox", { p_days: eventRetentionDays(process.env.EVENT_RETENTION_DAYS) });

    return ok({
      ...dispatched,
      purged: typeof purged === "number" ? purged : 0,
      events_purged: typeof eventsPurged === "number" ? eventsPurged : 0,
      providers: { email: providers.email?.name ?? null, sms: providers.sms?.name ?? null },
      configuration_problems: config.problems,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}

export const GET = run;
export const POST = run;
