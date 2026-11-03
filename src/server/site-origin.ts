import { headers } from "next/headers";

/**
 * The public origin of this site, for absolute links (share sheets, QR codes).
 * NEXT_PUBLIC_SITE_URL wins when set (use it in production behind a proxy); otherwise
 * it is derived from the request. Only http(s) origins are ever returned.
 */
export async function siteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  if (configured && /^https?:\/\/[^\s/]+$/i.test(configured)) return configured;
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000").split(",")[0]?.trim() ?? "localhost:3000";
  const proto = (h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https")).split(",")[0]?.trim();
  return /^[a-z0-9.:-]+$/i.test(host) && (proto === "http" || proto === "https") ? `${proto}://${host}` : "http://localhost:3000";
}