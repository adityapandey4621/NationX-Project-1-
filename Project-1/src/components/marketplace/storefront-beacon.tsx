"use client";

import { useEffect } from "react";

type Action = "view" | "call" | "whatsapp" | "directions";

function send(slug: string, action: Action) {
  try {
    const body = new Blob([JSON.stringify({ action })], { type: "application/json" });
    if (!navigator.sendBeacon(`/api/v1/storefronts/${encodeURIComponent(slug)}/track`, body)) {
      void fetch(`/api/v1/storefronts/${encodeURIComponent(slug)}/track`, { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } });
    }
  } catch {
    // Counting is best-effort and must never get in the way of calling a shop.
  }
}

/**
 * Counts one page view per browser tab session, and taps on anything marked
 * `data-track="call|whatsapp|directions"`. Sends only the shop's slug and the action:
 * no cookies, ids or location. Works with or without the visitor's consent to location.
 */
export function StorefrontBeacon({ slug }: { slug: string }) {
  useEffect(() => {
    try {
      const key = `nx_viewed_${slug}`;
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, "1");
        send(slug, "view");
      }
    } catch {
      send(slug, "view");
    }
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-track]");
      const action = el?.getAttribute("data-track");
      if (action === "call" || action === "whatsapp" || action === "directions") send(slug, action);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [slug]);
  return null;
}