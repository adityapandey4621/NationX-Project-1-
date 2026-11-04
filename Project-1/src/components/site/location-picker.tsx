"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

interface Area {
  slug: string;
  name: string;
  district: string;
}

/**
 * Manual area selector. It never asks for device location. Areas are grouped by
 * district, so adding localities or whole cities is a data change only. Choosing
 * an area stores a non-sensitive slug in a cookie via a server action and returns
 * to the current listing page.
 */
export function LocationPicker({
  areas,
  current,
  action,
  className,
  allLabel,
}: {
  areas: Area[];
  current: Area | null;
  action: (formData: FormData) => void | Promise<void>;
  className?: string;
  /** Translated "All of <city>" shown when no area is chosen. */
  allLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (areas.length === 0) return null;

  const districts = [...new Set(areas.map((a) => a.district))];

  return (
    <div ref={root} className={cn("relative", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-10 max-w-48 items-center gap-1.5 rounded-xl border bg-card px-3 text-sm font-medium shadow-card outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <MapPin aria-hidden className="size-4 shrink-0 text-primary" />
        <span className="truncate">{current ? current.name : allLabel}</span>
        <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <form
          id={panelId}
          action={action}
          className="absolute left-0 z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border bg-popover p-2 shadow-lift"
          aria-label="Choose your area"
        >
          <input type="hidden" name="next" value={pathname} />
          <p className="px-2 pt-1 pb-2 text-xs text-muted-foreground">Pick an area to see stores near you. We never use your device location.</p>
          <div className="max-h-72 overflow-auto">
            {districts.map((district) => (
              <div key={district} className="pb-1">
                <p className="px-2 py-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">{district}</p>
                <button type="submit" name="locality" value="" className="flex w-full items-center justify-between rounded-lg px-2 py-2.5 text-left text-sm hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                  All of {district}
                  {current === null ? <Check aria-hidden className="size-4 text-primary" /> : null}
                </button>
                {areas
                  .filter((a) => a.district === district)
                  .map((a) => (
                    <button
                      key={a.slug}
                      type="submit"
                      name="locality"
                      value={a.slug}
                      className="flex w-full items-center justify-between rounded-lg px-2 py-2.5 text-left text-sm hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      {a.name}
                      {current?.slug === a.slug ? <Check aria-hidden className="size-4 text-primary" /> : null}
                    </button>
                  ))}
              </div>
            ))}
          </div>
        </form>
      ) : null}
    </div>
  );
}
