"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInstallPrompt } from "@/components/site/use-install-prompt";

/**
 * One-tap install where the browser supports it (Android Chrome, desktop Chrome/Edge). Elsewhere it shows the
 * short manual steps. Nothing is downloaded from a store and nothing is tracked.
 */
export function InstallButton({ labels }: { labels: { install: string; installed: string; ios: string; manual: string } }) {
  const { canInstall, standalone, ios, install } = useInstallPrompt();
  if (standalone) return <p role="status" className="text-sm font-medium text-success">{labels.installed}</p>;
  return (
    <div className="space-y-3">
      {canInstall ? (
        <Button type="button" size="lg" onClick={install} data-testid="install-app">
          <Download aria-hidden className="size-5" /> {labels.install}
        </Button>
      ) : null}
      <p className="text-sm text-muted-foreground">{ios ? labels.ios : labels.manual}</p>
    </div>
  );
}