import type { SupabaseClient } from "@supabase/supabase-js";
import type { Provider } from "./providers";
import { renderMessage, type NotificationChannel, type NotificationTemplate } from "./templates";

/** A row returned by the claim_notifications() database function. */
export interface QueuedNotification {
  id: string;
  channel: NotificationChannel;
  template: NotificationTemplate;
  recipient: string;
  locale: string;
  data: Record<string, unknown>;
  attempts: number;
}

export interface DispatchResult {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  /** Channels with no provider configured: their messages were left waiting (and expire after 3 days). */
  idle_channels: NotificationChannel[];
}

export interface DispatchOptions {
  appUrl: string;
  limit?: number;
  /** Messages sent at the same time. Small on purpose: gentle on providers and on serverless time limits. */
  concurrency?: number;
  /** Stop starting new sends after this many ms (the rest stay queued for the next run). */
  budgetMs?: number;
  now?: () => number;
}

/**
 * One dispatcher run: claim due messages for the channels that have a provider, send them, record each outcome.
 * Safe to run from several schedulers at once (the database hands each message to exactly one claimer) and
 * safe to run with nothing configured. The result never includes recipients or message text.
 */
export async function dispatchNotifications(
  db: SupabaseClient,
  providers: { email: Provider | null; sms: Provider | null },
  options: DispatchOptions,
): Promise<DispatchResult> {
  const now = options.now ?? Date.now;
  const started = now();
  const budget = options.budgetMs ?? 40_000;
  const concurrency = Math.max(1, options.concurrency ?? 5);
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);

  const channels = (["email", "sms"] as const).filter((c) => providers[c]);
  const idle_channels = (["email", "sms"] as const).filter((c) => !providers[c]);
  const result: DispatchResult = { claimed: 0, sent: 0, retried: 0, failed: 0, idle_channels };
  if (channels.length === 0) return result;

  const { data, error } = await db.rpc("claim_notifications", { p_channels: channels, p_limit: limit });
  if (error) throw new Error(`claim_notifications failed: ${error.message}`);
  const rows = (data ?? []) as QueuedNotification[];
  result.claimed = rows.length;

  async function handle(row: QueuedNotification): Promise<void> {
    const provider = providers[row.channel];
    let outcome: { ok: boolean; permanent: boolean; error: string | null };
    if (!provider) {
      outcome = { ok: false, permanent: false, error: "no provider configured" };
    } else if (now() - started > budget) {
      // Out of time: hand it back untouched-ish (counts as a retry without blaming the provider).
      outcome = { ok: false, permanent: false, error: "deferred: run time budget used" };
    } else {
      const m = renderMessage({ template: row.template, channel: row.channel, locale: row.locale, data: row.data, appUrl: options.appUrl });
      const r = await provider.send({
        to: row.recipient,
        ...(m.subject ? { subject: m.subject } : {}),
        text: m.text,
        ...(m.html ? { html: m.html } : {}),
        template: row.template,
        variables: m.variables,
        idempotencyKey: `nx-${row.id}`,
      });
      outcome = r.ok ? { ok: true, permanent: false, error: null } : { ok: false, permanent: r.permanent, error: r.error };
    }

    const { data: state, error: finishError } = await db.rpc("finish_notification", {
      p_id: row.id,
      p_ok: outcome.ok,
      p_error: outcome.error,
      p_permanent: outcome.permanent,
    });
    if (finishError) {
      // The send itself may have succeeded; the row stays 'sending' and is reclaimed after 5 minutes, and the
      // provider's idempotency key stops a duplicate. Count it as a retry so the run is honest.
      result.retried += 1;
      return;
    }
    if (state === "sent") result.sent += 1;
    else if (state === "failed") result.failed += 1;
    else result.retried += 1;
  }

  for (let i = 0; i < rows.length; i += concurrency) {
    await Promise.all(rows.slice(i, i + concurrency).map(handle));
  }
  return result;
}
