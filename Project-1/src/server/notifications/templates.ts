/**
 * Message wording for the notification queue. English only for now: Telugu wording must be written and
 * reviewed by a native speaker before it is sent to real shopkeepers (the queue already stores each
 * person's language, so adding it later is a change to this file only).
 *
 * Rules: never put item names or private notes in an SMS; escape everything inserted into HTML; links point
 * to pages that need sign-in or a tracking ID, so a leaked message does not expose data.
 */

export type NotificationTemplate = "application_approved" | "application_rejected" | "application_corrections" | "help_request_update";
export type NotificationChannel = "email" | "sms";

export interface RenderInput {
  template: NotificationTemplate;
  channel: NotificationChannel;
  locale: string;
  data: Record<string, unknown>;
  appUrl: string;
}

export interface RenderedMessage {
  subject?: string;
  text: string;
  html?: string;
  /** Flat string variables, for gateways that fill a pre-registered (DLT) template themselves. */
  variables: Record<string, string>;
}

const STATUS_WORDS: Record<string, string> = {
  under_review: "is being looked at by our team",
  matched: "has a possible match",
  unresolved: "could not be matched yet",
};

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v.trim() : fallback);
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function renderMessage(input: RenderInput): RenderedMessage {
  const { template, channel, appUrl } = input;
  const business = clip(str(input.data.business_name, "your shop"), 80);
  const reason = clip(str(input.data.reason), 600);
  const applicationId = str(input.data.application_id);
  const trackingId = clip(str(input.data.tracking_id), 40);
  const name = clip(str(input.data.contact_name), 60);
  const status = str(input.data.status);

  const applicationLink = applicationId ? `${appUrl}/merchant/applications/${encodeURIComponent(applicationId)}` : `${appUrl}/merchant`;
  const trackLink = `${appUrl}/help-me-find-it/track`;

  let subject = "";
  let lines: string[] = [];
  let sms = "";
  let link = applicationLink;

  switch (template) {
    case "application_approved":
      subject = `${business} is approved on NationX`;
      lines = [
        `Good news: ${business} has been approved and your storefront is now live on NationX.`,
        "Sign in to see your page, add your opening hours and photos, and list your items.",
      ];
      sms = `NationX: ${business} is approved and your page is live. Sign in to manage it: ${applicationLink}`;
      break;
    case "application_rejected":
      subject = `Update on your NationX application for ${business}`;
      lines = [
        `We could not approve the application for ${business} this time.`,
        ...(reason ? [`Reason from our team: ${reason}`] : []),
        "You can sign in to see the details. If something was missing, you are welcome to apply again.",
      ];
      sms = `NationX: we could not approve the application for ${business}. Sign in for details: ${applicationLink}`;
      break;
    case "application_corrections":
      subject = `Please update your NationX application for ${business}`;
      lines = [
        `Our team needs a small update before ${business} can be approved.`,
        ...(reason ? [`What to fix: ${reason}`] : []),
        "Sign in, make the change and send the application again.",
      ];
      sms = `NationX: please update the application for ${business} and send it again: ${applicationLink}`;
      break;
    case "help_request_update": {
      const what = STATUS_WORDS[status] ?? "has an update";
      link = trackLink;
      subject = `Update on your NationX request ${trackingId}`.trim();
      lines = [
        `${name ? `Hello ${name}, your` : "Your"} Help Me Find It request ${trackingId} ${what}.`,
        "Open the tracking page and enter your tracking ID and phone number to see the details.",
      ];
      sms = `NationX: your request ${trackingId} ${what}. Track it: ${trackLink}`;
      break;
    }
  }

  const variables: Record<string, string> = {
    business_name: business,
    tracking_id: trackingId,
    status,
    link,
    ...(applicationId ? { application_id: applicationId } : {}),
  };

  if (channel === "sms") return { text: clip(sms, 300), variables };

  const text = `${lines.join("\n\n")}\n\n${link}\n\n— NationX`;
  const html =
    `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;line-height:1.5;color:#111">` +
    lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("") +
    `<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#0F766E;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Open NationX</a></p>` +
    `<p style="color:#666;font-size:13px">You received this because of activity on your NationX account or request.</p></div>`;
  return { subject, text, html, variables };
}
