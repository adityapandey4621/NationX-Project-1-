"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * One-tap install where the browser supports it (Android Chrome, desktop Chrome/Edge). Elsewhere it shows the
 * short manual steps. Nothing is downloaded from a store and nothing is tracked.
 */
export function InstallButton({ labels }: { labels: { install: string; installed: string; ios: string; manual: string } }) {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    setStandalone(window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (standalone) return <p role="status" className="text-sm font-medium text-success">{labels.installed}</p>;
  return (
    <div className="space-y-2">
      {evt ? (
        <Button
          type="button"
          size="lg"
          onClick={async () => {
            await evt.prompt();
            await evt.userChoice.catch(() => undefined);
            setEvt(null);
          }}
        >
          <Download aria-hidden className="size-5" /> {labels.install}
        </Button>
      ) : null}
      <p className="text-sm text-muted-foreground">{ios ? labels.ios : labels.manual}</p>
    </div>
  );
}