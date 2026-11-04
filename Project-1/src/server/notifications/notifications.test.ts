import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { isAuthorizedScheduler } from "./authorize";
import { loadNotificationConfig } from "./config";
import { dispatchNotifications, type QueuedNotification } from "./dispatch";
import { buildProviders, classifyStatus, createResendProvider, createWebhookProvider, type OutboundMessage, type Provider } from "./providers";
import { escapeHtml, renderMessage } from "./templates";

const SECRET = "a-long-enough-scheduler-secret";

describe("loadNotificationConfig", () => {
  it("configures nothing by default", () => {
    const c = loadNotificationConfig({});
    expect(c.email).toBeNull();
    expect(c.sms).toBeNull();
    expect(c.problems).toEqual([]);
    expect(c.appUrl).toBe("http://localhost:3000");
  });

  it("reads Resend, a webhook SMS gateway and trims the app URL", () => {
    const c = loadNotificationConfig({
      EMAIL_PROVIDER: "Resend", EMAIL_API_KEY: "re_x", EMAIL_FROM: "NationX <hello@example.com>",
      SMS_PROVIDER: "webhook", SMS_WEBHOOK_URL: "https://sms.example.com/send", SMS_WEBHOOK_TOKEN: "tok",
      NEXT_PUBLIC_APP_URL: "https://nationx.example.com/",
    });
    expect(c.email).toEqual({ provider: "resend", apiKey: "re_x", from: "NationX <hello@example.com>" });
    expect(c.sms).toEqual({ provider: "webhook", url: "https://sms.example.com/send", token: "tok" });
    expect(c.appUrl).toBe("https://nationx.example.com");
  });

  it("disables a half-configured channel and says why, instead of half-working", () => {
    const c = loadNotificationConfig({ EMAIL_PROVIDER: "resend", EMAIL_API_KEY: "re_x", SMS_PROVIDER: "webhook" });
    expect(c.email).toBeNull();
    expect(c.sms).toBeNull();
    expect(c.problems.join(" ")).toMatch(/EMAIL_FROM/);
    expect(c.problems.join(" ")).toMatch(/SMS_WEBHOOK_URL/);
  });

  it("refuses plain-http webhooks except for localhost, and unknown providers", () => {
    expect(loadNotificationConfig({ SMS_PROVIDER: "webhook", SMS_WEBHOOK_URL: "http://sms.example.com/x" }).sms).toBeNull();
    expect(loadNotificationConfig({ SMS_PROVIDER: "webhook", SMS_WEBHOOK_URL: "http://localhost:9000/x" }).sms).not.toBeNull();
    expect(loadNotificationConfig({ SMS_PROVIDER: "webhook", SMS_WEBHOOK_URL: "ftp://x.example.com" }).sms).toBeNull();
    expect(loadNotificationConfig({ EMAIL_PROVIDER: "carrier-pigeon" }).problems.join(" ")).toMatch(/not supported/);
  });
});

describe("renderMessage", () => {
  const base = { locale: "en", appUrl: "https://nx.example.com" };

  it("approval: e-mail has subject, text and html; SMS is short plain text with a link", () => {
    const data = { business_name: "Sri Ram Kirana", application_id: "11111111-1111-1111-1111-111111111111" };
    const mail = renderMessage({ ...base, template: "application_approved", channel: "email", data });
    expect(mail.subject).toContain("Sri Ram Kirana");
    expect(mail.html).toContain("https://nx.example.com/merchant/applications/11111111-1111-1111-1111-111111111111");
    const sms = renderMessage({ ...base, template: "application_approved", channel: "sms", data });
    expect(sms.subject).toBeUndefined();
    expect(sms.html).toBeUndefined();
    expect(sms.text.length).toBeLessThanOrEqual(300);
    expect(sms.text).toContain("approved");
  });

  it("escapes anything a user typed before putting it in HTML", () => {
    const m = renderMessage({ ...base, template: "application_rejected", channel: "email", data: { business_name: "<script>alert(1)</script>", reason: `"><img src=x onerror=alert(2)>` } });
    expect(m.html).not.toContain("<script>");
    expect(m.html).not.toContain("<img");
    expect(m.html).toContain("&lt;script&gt;");
    expect(escapeHtml(`a&b<c>"d'`)).toBe("a&amp;b&lt;c&gt;&quot;d&#39;");
  });

  it("an SMS never contains the rejection reason or correction notes", () => {
    for (const template of ["application_rejected", "application_corrections"] as const) {
      const sms = renderMessage({ ...base, template, channel: "sms", data: { business_name: "X", reason: "Private note about your documents" } });
      expect(sms.text).not.toContain("Private note");
    }
    const mail = renderMessage({ ...base, template: "application_corrections", channel: "email", data: { business_name: "X", reason: "Private note about your documents" } });
    expect(mail.text).toContain("Private note");
  });

  it("help request update names the status and links to the tracking page, never an item", () => {
    const sms = renderMessage({ ...base, template: "help_request_update", channel: "sms", data: { tracking_id: "HMF-KHM-202611-0001", status: "matched" } });
    expect(sms.text).toContain("HMF-KHM-202611-0001");
    expect(sms.text).toContain("possible match");
    expect(sms.text).toContain("https://nx.example.com/help-me-find-it/track");
  });

  it("copes with missing data and clips very long values", () => {
    const m = renderMessage({ ...base, template: "application_rejected", channel: "sms", data: { business_name: "x".repeat(500) } });
    expect(m.text.length).toBeLessThanOrEqual(300);
    expect(() => renderMessage({ ...base, template: "help_request_update", channel: "email", data: {} })).not.toThrow();
  });
});

describe("providers", () => {
  const msg: OutboundMessage = { to: "owner@example.com", subject: "Hi", text: "body", html: "<p>body</p>", template: "application_approved", variables: { business_name: "X" }, idempotencyKey: "nx-1" };

  it("classifies HTTP statuses: 2xx ok, transient retry, other 4xx permanent", () => {
    expect(classifyStatus(200)).toBe("ok");
    expect(classifyStatus(202)).toBe("ok");
    for (const s of [408, 425, 429, 500, 502, 503]) expect(classifyStatus(s)).toBe("retry");
    for (const s of [400, 401, 403, 404, 422]) expect(classifyStatus(s)).toBe("permanent");
  });

  it("Resend: posts to the Resend API with a bearer key, idempotency key and the right body", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    const p = createResendProvider({ provider: "resend", apiKey: "re_secret", from: "NationX <hi@example.com>" }, fetchMock as unknown as typeof fetch);
    expect(await p.send(msg)).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_secret");
    expect(headers["Idempotency-Key"]).toBe("nx-1");
    expect(JSON.parse(init.body as string)).toMatchObject({ from: "NationX <hi@example.com>", to: ["owner@example.com"], subject: "Hi", text: "body" });
    expect(init.redirect).toBe("error");
  });

  it("webhook: sends channel, recipient, template and variables; token is optional", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 202 }));
    const p = createWebhookProvider("sms", { url: "https://sms.example.com/send" }, fetchMock as unknown as typeof fetch);
    await p.send({ ...msg, to: "+919812345678", subject: undefined, html: undefined } as OutboundMessage);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(JSON.parse(init.body as string)).toMatchObject({ channel: "sms", to: "+919812345678", template: "application_approved", variables: { business_name: "X" }, idempotency_key: "nx-1" });
    const withToken = createWebhookProvider("email", { url: "https://x.example.com", token: "t0k" }, fetchMock as unknown as typeof fetch);
    await withToken.send(msg);
    expect(((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].headers as Record<string, string>).Authorization).toBe("Bearer t0k");
  });

  it("maps provider failures: 5xx/429 retry, 4xx permanent, network errors and timeouts retry", async () => {
    const mk = (f: () => Promise<Response>) => createWebhookProvider("email", { url: "https://x.example.com" }, f as unknown as typeof fetch);
    expect(await mk(async () => new Response("down", { status: 503 })).send(msg)).toMatchObject({ ok: false, permanent: false });
    expect(await mk(async () => new Response("slow down", { status: 429 })).send(msg)).toMatchObject({ ok: false, permanent: false });
    expect(await mk(async () => new Response("bad address", { status: 422 })).send(msg)).toMatchObject({ ok: false, permanent: true });
    expect(await mk(async () => { throw new Error("ECONNRESET"); }).send(msg)).toMatchObject({ ok: false, permanent: false });
    const timeout = Object.assign(new Error("t"), { name: "TimeoutError" });
    expect(await mk(async () => { throw timeout; }).send(msg)).toEqual({ ok: false, permanent: false, error: "timed out" });
  });

  it("failure text never contains the recipient or the token", async () => {
    const p = createWebhookProvider("email", { url: "https://x.example.com", token: "TOKEN123" }, (async () => new Response("rejected", { status: 400 })) as unknown as typeof fetch);
    const r = await p.send(msg);
    expect(JSON.stringify(r)).not.toContain("owner@example.com");
    expect(JSON.stringify(r)).not.toContain("TOKEN123");
  });

  it("buildProviders returns null for unconfigured channels", () => {
    expect(buildProviders({ email: null, sms: null })).toEqual({ email: null, sms: null });
    const p = buildProviders({ email: { provider: "resend", apiKey: "k", from: "f" }, sms: { provider: "webhook", url: "https://s.example.com" } });
    expect(p.email?.name).toBe("resend");
    expect(p.sms?.name).toBe("sms-webhook");
  });
});

describe("isAuthorizedScheduler", () => {
  it("accepts only the exact bearer secret", () => {
    expect(isAuthorizedScheduler(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isAuthorizedScheduler(`bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isAuthorizedScheduler(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isAuthorizedScheduler(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toBe(false);
    expect(isAuthorizedScheduler(SECRET, SECRET)).toBe(false);
    expect(isAuthorizedScheduler(null, SECRET)).toBe(false);
    expect(isAuthorizedScheduler("", SECRET)).toBe(false);
  });

  it("an unset or short secret authorises nobody, not even an empty header", () => {
    expect(isAuthorizedScheduler("Bearer ", undefined)).toBe(false);
    expect(isAuthorizedScheduler("Bearer anything", "")).toBe(false);
    expect(isAuthorizedScheduler("Bearer short", "short")).toBe(false);
  });
});

describe("dispatchNotifications", () => {
  const row = (over: Partial<QueuedNotification> = {}): QueuedNotification => ({
    id: "n1", channel: "email", template: "application_approved", recipient: "owner@example.com", locale: "en",
    data: { business_name: "Sri Ram", application_id: "a1" }, attempts: 1, ...over,
  });

  function fakeDb(rows: QueuedNotification[], finishState: (id: string, ok: boolean, permanent: boolean) => string = (_i, ok, perm) => (ok ? "sent" : perm ? "failed" : "retry")) {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const db = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        if (fn === "claim_notifications") return { data: rows, error: null };
        if (fn === "finish_notification") return { data: finishState(args.p_id as string, args.p_ok as boolean, args.p_permanent as boolean), error: null };
        return { data: null, error: { message: "unknown" } };
      },
    } as unknown as SupabaseClient;
    return { db, calls };
  }
  const provider = (send: Provider["send"]): Provider => ({ name: "fake", send });
  const opts = { appUrl: "https://nx.example.com" };

  it("does nothing, and never touches the database, when no provider is configured", async () => {
    const { db, calls } = fakeDb([row()]);
    const r = await dispatchNotifications(db, { email: null, sms: null }, opts);
    expect(r).toEqual({ claimed: 0, sent: 0, retried: 0, failed: 0, idle_channels: ["email", "sms"] });
    expect(calls).toHaveLength(0);
  });

  it("claims only the channels that have a provider", async () => {
    const { db, calls } = fakeDb([]);
    await dispatchNotifications(db, { email: provider(async () => ({ ok: true })), sms: null }, opts);
    expect(calls[0]).toEqual({ fn: "claim_notifications", args: { p_channels: ["email"], p_limit: 20 } });
  });

  it("sends, records success, and passes a stable idempotency key", async () => {
    const send = vi.fn<Provider["send"]>(async () => ({ ok: true }));
    const { db, calls } = fakeDb([row({ id: "abc" })]);
    const r = await dispatchNotifications(db, { email: provider(send), sms: null }, opts);
    expect(r).toMatchObject({ claimed: 1, sent: 1, retried: 0, failed: 0 });
    expect(send.mock.calls[0]?.[0]).toMatchObject({ to: "owner@example.com", idempotencyKey: "nx-abc", template: "application_approved" });
    expect(calls.find((c) => c.fn === "finish_notification")?.args).toEqual({ p_id: "abc", p_ok: true, p_error: null, p_permanent: false });
  });

  it("transient failure -> retry; permanent failure -> failed; each recorded with the provider's reason", async () => {
    const send = vi.fn<Provider["send"]>()
      .mockResolvedValueOnce({ ok: false, permanent: false, error: "HTTP 503" })
      .mockResolvedValueOnce({ ok: false, permanent: true, error: "HTTP 422: bad address" });
    const { db, calls } = fakeDb([row({ id: "a" }), row({ id: "b" })]);
    const r = await dispatchNotifications(db, { email: provider(send), sms: null }, { ...opts, concurrency: 1 });
    expect(r).toMatchObject({ claimed: 2, sent: 0, retried: 1, failed: 1 });
    const finishes = calls.filter((c) => c.fn === "finish_notification").map((c) => c.args);
    expect(finishes).toEqual([
      { p_id: "a", p_ok: false, p_error: "HTTP 503", p_permanent: false },
      { p_id: "b", p_ok: false, p_error: "HTTP 422: bad address", p_permanent: true },
    ]);
  });

  it("one failing message does not stop the others", async () => {
    const send = vi.fn<Provider["send"]>().mockResolvedValueOnce({ ok: false, permanent: false, error: "x" }).mockResolvedValue({ ok: true });
    const { db } = fakeDb([row({ id: "1" }), row({ id: "2" }), row({ id: "3" })]);
    const r = await dispatchNotifications(db, { email: provider(send), sms: null }, { ...opts, concurrency: 1 });
    expect(r).toMatchObject({ sent: 2, retried: 1 });
  });

  it("stops starting sends once the time budget is used, returning the rest for later", async () => {
    let t = 0;
    const send = vi.fn<Provider["send"]>(async () => { t += 30_000; return { ok: true }; });
    const { db, calls } = fakeDb([row({ id: "1" }), row({ id: "2" }), row({ id: "3" })]);
    const r = await dispatchNotifications(db, { email: provider(send), sms: null }, { ...opts, concurrency: 1, budgetMs: 40_000, now: () => t });
    expect(send).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ claimed: 3, sent: 2, retried: 1 });
    expect(calls.filter((c) => c.fn === "finish_notification").pop()?.args).toMatchObject({ p_id: "3", p_ok: false, p_permanent: false });
  });

  it("a message whose channel lost its provider is handed back, not dropped", async () => {
    const { db, calls } = fakeDb([row({ channel: "sms", id: "s1" })]);
    const r = await dispatchNotifications(db, { email: provider(async () => ({ ok: true })), sms: null }, opts);
    // sms is not claimed at all (so this row would not normally arrive); if it does, it is returned for retry.
    expect(calls[0]?.args.p_channels).toEqual(["email"]);
    expect(r.retried).toBe(1);
  });

  it("surfaces a claim failure instead of pretending success", async () => {
    const db = { rpc: async () => ({ data: null, error: { message: "permission denied" } }) } as unknown as SupabaseClient;
    await expect(dispatchNotifications(db, { email: provider(async () => ({ ok: true })), sms: null }, opts)).rejects.toThrow(/permission denied/);
  });

  it("clamps the batch size", async () => {
    const { db, calls } = fakeDb([]);
    await dispatchNotifications(db, { email: provider(async () => ({ ok: true })), sms: null }, { ...opts, limit: 5000 });
    expect(calls[0]?.args.p_limit).toBe(100);
  });
});
