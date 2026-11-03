"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Menu, X } from "lucide-react";

/**
 * Phone navigation: a menu button that opens a full-width panel. The links are
 * server-rendered and passed in as children (so they stay role-aware); this
 * component only owns open/closed state, and closes on navigation and Escape.
 */
export function MobileNav({ children, openLabel, closeLabel }: { children: React.ReactNode; openLabel: string; closeLabel: string }) {
  const [open, setOpen] = useState(false);
  const [seenPath, setSeenPath] = useState<string | null>(null);
  const pathname = usePathname();
  const panelId = useId();

  // Close when the route changes (derived during render, not in an effect).
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    if (open) setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? closeLabel : openLabel}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex size-10 items-center justify-center rounded-xl border bg-card shadow-card outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {open ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
      </button>
      {open ? (
        <nav id={panelId} aria-label="Menu" className="absolute inset-x-0 top-full z-50 border-b bg-background px-4 pt-2 pb-4 shadow-lift">
          <div className="mx-auto flex max-w-6xl flex-col gap-1">{children}</div>
        </nav>
      ) : null}
    </div>
  );
}
