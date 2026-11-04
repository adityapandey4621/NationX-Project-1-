import type { EmailConfig, SmsConfig } from "./config";

export interface OutboundMessage {
  to: string;
  subject?: string;
  text: string;
  html?: string;
  /** Template key + flat variables, for gateways that fill their own pre-registered template. */
  template: string;
  variables: Record<string, string>;
  /** Stable per queue row: a provider that supports idempotency will not deliver a retried send twice. */
  idempotencyKey: string;
}

export type SendResult = { ok: true } | { ok: false; permanent: boolean; error: string };

export interface Provider {
  readonly name: string;
  send(message: OutboundMessage): Promise<SendResult>;
}

type FetchLike = typeof fetch;
const TIMEOUT_MS = 10_000;

/**
 * 2xx = delivered to the provider. 408/425/429/5xx and network failures are worth retrying; any other 4xx means
 * the request itself is wrong (bad address, bad key) and retrying would only repeat it, so it is final.
 */
export function classifyStatus(status: number): "ok" | "retry" | "permanent" {
  if (status >= 200 && status < 300) return "ok";
  if (status === 408 || status === 425 || status === 429 || status >= 500) return "retry";
  return "permanent";
}

/** A short, safe error string: status plus a clipped, whitespace-collapsed body. Never the request (it holds the address). */
async function describeFailure(res: Response): Promise<string> {
  let body = "";
  try {
    body = (await res.text()).replace(/\s+/g, " ").slice(0, 160);
  } catch {
    /* ignore */
  }
  return `HTTP ${res.status}${body ? `: ${body}` : ""}`;
}

async function post(fetchImpl: FetchLike, url: string, headers: Record<string, string>, body: unknown): Promise<SendResult> {
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error", // a gateway that redirects is misconfigured; never follow it to somewhere else with our token
    });
    const kind = classifyStatus(res.status);
    if (kind === "ok") return { ok: true };
    return { ok: false, permanent: kind === "permanent", error: await describeFailure(res) };
  } catch (e) {
    const name = (e as Error).name;
    return { ok: false, permanent: false, error: name === "TimeoutError" || name === "AbortError" ? "timed out" : `network error: ${(e as Error).message}`.slice(0, 160) };
  }
}

/** Resend (https://resend.com/docs/api-reference/emails/send-email). */
export function createResendProvider(cfg: Extract<EmailConfig, { provider: "resend" }>, fetchImpl: FetchLike = fetch): Provider {
  return {
    name: "resend",
    send: (m) =>
      post(
        fetchImpl,
        "https://api.resend.com/emails",
        { Authorization: `Bearer ${cfg.apiKey}`, "Idempotency-Key": m.idempotencyKey },
        { from: cfg.from, to: [m.to], subject: m.subject ?? "NationX", text: m.text, ...(m.html ? { html: m.html } : {}) },
      ),
  };
}

/**
 * Generic JSON gateway: POST {channel, to, subject?, text, html?, template, variables, idempotency_key} with an optional
 * bearer token. Point it at any service you run (an SMS gateway, a Supabase Edge Function, Zapier, ...). Reply 2xx on
 * success; 4xx means "do not retry"; 5xx/429 means "try again later".
 */
export function createWebhookProvider(channel: "email" | "sms", cfg: { url: string; token?: string }, fetchImpl: FetchLike = fetch): Provider {
  return {
    name: `${channel}-webhook`,
    send: (m) =>
      post(
        fetchImpl,
        cfg.url,
        { ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}), "Idempotency-Key": m.idempotencyKey },
        {
          channel,
          to: m.to,
          ...(m.subject ? { subject: m.subject } : {}),
          text: m.text,
          ...(m.html ? { html: m.html } : {}),
          template: m.template,
          variables: m.variables,
          idempotency_key: m.idempotencyKey,
        },
      ),
  };
}

export function buildProviders(cfg: { email: EmailConfig | null; sms: SmsConfig | null }, fetchImpl: FetchLike = fetch): { email: Provider | null; sms: Provider | null } {
  return {
    email: !cfg.email ? null : cfg.email.provider === "resend" ? createResendProvider(cfg.email, fetchImpl) : createWebhookProvider("email", cfg.email, fetchImpl),
    sms: cfg.sms ? createWebhookProvider("sms", cfg.sms, fetchImpl) : null,
  };
}
