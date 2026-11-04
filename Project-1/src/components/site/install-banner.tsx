"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { useInstallPrompt } from "@/components/site/use-install-prompt";

const KEY = "nx_install_dismissed";
const QUIET_DAYS = 14;

/**
 * A slim banner that appears ONLY when the browser says the app can be installed right now, never inside the
 * installed app, and stays away for two weeks once closed. No tracking, no pop-ups.
 */
export function InstallBanner({ labels }: { labels: { text: string; install: string; close: string } }) {
  const { canInstall, standalone, install } = useInstallPrompt();
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    try {
      const at = Number(localStorage.getItem(KEY) ?? 0);
      setHidden(Date.now() - at < QUIET_DAYS * 86_400_000);
    } catch {
      setHidden(false);
    }
  }, []);

  if (!canInstall || standalone || hidden) return null;
  return (
    <div role="region" aria-label={labels.text} className="border-b bg-brand-soft">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2">
        <Download aria-hidden className="size-5 shrink-0 text-primary" />
        <p className="min-w-0 flex-1 text-sm font-medium">{labels.text}</p>
        <button type="button" onClick={install} className="inline-flex h-9 shrink-0 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          {labels.install}
        </button>
        <button
          type="button"
          aria-label={labels.close}
          onClick={() => {
            try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ }
            setHidden(true);
          }}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
    </div>
  );
}