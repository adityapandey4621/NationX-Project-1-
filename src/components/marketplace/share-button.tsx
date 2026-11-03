"use client";

import { useState } from "react";
import { Check, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Uses the phone's share sheet when there is one (WhatsApp, etc.), otherwise copies the link. */
export function ShareButton({ url, title, label, copiedLabel }: { url: string; title: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Cancelled share sheet or blocked clipboard: nothing to recover from.
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={share}>
      {copied ? <Check aria-hidden className="size-4" /> : <Share2 aria-hidden className="size-4" />}
      <span role="status">{copied ? copiedLabel : label}</span>
    </Button>
  );
}