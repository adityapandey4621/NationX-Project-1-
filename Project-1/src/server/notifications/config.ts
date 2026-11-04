import { z } from "zod";

/**
 * Notification provider settings, read from the environment. Nothing is configured by default: with no provider
 * the queue simply waits (and old messages expire), so the platform works without any e-mail/SMS account.
 *
 *   EMAIL_PROVIDER=resend    + EMAIL_API_KEY + EMAIL_FROM            (Resend, https://resend.com)
 *   EMAIL_PROVIDER=webhook   + EMAIL_WEBHOOK_URL [+ EMAIL_WEBHOOK_TOKEN]   (any gateway you operate)
 *   SMS_PROVIDER=webhook     + SMS_WEBHOOK_URL   [+ SMS_WEBHOOK_TOKEN]     (e.g. a DLT-registered SMS gateway)
 *
 * Webhook URLs must be https (http is allowed only for localhost, for development).
 */

const httpsOrLocal = z.url().refine((u) => {
  try {
    const url = new URL(u);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
  } catch {
    return false;
  }
}, "must be an https URL (http only for localhost)");

export type EmailConfig =
  | { provider: "resend"; apiKey: string; from: string }
  | { provider: "webhook"; url: string; token?: string };
export type SmsConfig = { provider: "webhook"; url: string; token?: string };

export interface NotificationConfig {
  email: EmailConfig | null;
  sms: SmsConfig | null;
  /** Public site address used for links inside messages (no trailing slash). */
  appUrl: string;
  /** Problems found while reading the settings: a misconfigured channel is disabled, never half-working. */
  problems: string[];
}

const blank = (v: string | undefined) => (v === undefined || v.trim() === "" ? undefined : v.trim());

export function loadNotificationConfig(env: Record<string, string | undefined> = process.env): NotificationConfig {
  const problems: string[] = [];
  const appUrl = (blank(env.NEXT_PUBLIC_APP_URL) ?? blank(env.NEXT_PUBLIC_SITE_URL) ?? "http://localhost:3000").replace(/\/+$/, "");

  let email: EmailConfig | null = null;
  const emailProvider = blank(env.EMAIL_PROVIDER)?.toLowerCase();
  if (emailProvider === "resend") {
    const apiKey = blank(env.EMAIL_API_KEY);
    const from = blank(env.EMAIL_FROM);
    if (!apiKey || !from) problems.push("EMAIL_PROVIDER=resend needs EMAIL_API_KEY and EMAIL_FROM");
    else email = { provider: "resend", apiKey, from };
  } else if (emailProvider === "webhook") {
    const url = httpsOrLocal.safeParse(blank(env.EMAIL_WEBHOOK_URL));
    if (!url.success) problems.push(`EMAIL_WEBHOOK_URL is missing or invalid (${url.error.issues[0]?.message ?? "invalid"})`);
    else {
      const token = blank(env.EMAIL_WEBHOOK_TOKEN);
      email = { provider: "webhook", url: url.data, ...(token ? { token } : {}) };
    }
  } else if (emailProvider) {
    problems.push(`EMAIL_PROVIDER "${emailProvider}" is not supported (use resend or webhook)`);
  }

  let sms: SmsConfig | null = null;
  const smsProvider = blank(env.SMS_PROVIDER)?.toLowerCase();
  if (smsProvider === "webhook") {
    const url = httpsOrLocal.safeParse(blank(env.SMS_WEBHOOK_URL));
    if (!url.success) problems.push(`SMS_WEBHOOK_URL is missing or invalid (${url.error.issues[0]?.message ?? "invalid"})`);
    else {
      const token = blank(env.SMS_WEBHOOK_TOKEN);
      sms = { provider: "webhook", url: url.data, ...(token ? { token } : {}) };
    }
  } else if (smsProvider) {
    problems.push(`SMS_PROVIDER "${smsProvider}" is not supported (use webhook)`);
  }

  return { email, sms, appUrl, problems };
}
