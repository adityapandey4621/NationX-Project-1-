"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { MapPin, Search, Store, Tag } from "lucide-react";
import { cn } from "@/lib/utils";

interface Suggestions {
  shops: { name: string; slug: string; category: string; locality: string }[];
  categories: { name: string; slug: string }[];
  localities: { name: string; slug: string }[];
}

interface Option {
  key: string;
  href: string;
  label: string;
  hint: string;
  kind: "shop" | "category" | "locality";
}

const ICONS = { shop: Store, category: Tag, locality: MapPin } as const;

function toOptions(s: Suggestions): Option[] {
  return [
    ...s.shops.map((x) => ({ key: `s-${x.slug}`, href: `/shop/${x.slug}`, label: x.name, hint: `${x.category} · ${x.locality}`, kind: "shop" as const })),
    ...s.categories.map((x) => ({ key: `c-${x.slug}`, href: `/category/${x.slug}`, label: x.name, hint: "Category", kind: "category" as const })),
    ...s.localities.map((x) => ({ key: `l-${x.slug}`, href: `/locality/${x.slug}`, label: x.name, hint: "Area", kind: "locality" as const })),
  ];
}

/**
 * Universal search. Without JavaScript it is a plain GET form to /search. With
 * JavaScript it adds debounced typeahead from /api/v1/discovery/suggest (real shops,
 * categories and areas) with full keyboard support (combobox pattern).
 */
export function SearchBox({
  action = "/search",
  defaultValue = "",
  locality,
  placeholder = "Search stores, products, categories or areas",
  buttonLabel = "Search",
  size = "lg",
  autoFocus,
  className,
  primary,
  children,
}: {
  action?: string;
  defaultValue?: string;
  /** Kept as a hidden field so a chosen area survives a new search. */
  locality?: string | undefined;
  placeholder?: string;
  /** Translated text of the submit button. */
  buttonLabel?: string;
  size?: "md" | "lg";
  autoFocus?: boolean;
  className?: string;
  /** This is the page's main search: the header's compact search hides itself (see globals.css). */
  primary?: boolean;
  /** Extra form controls (filters) submitted together with the query. */
  children?: React.ReactNode;
}) {
  const [value, setValue] = useState(defaultValue);
  const [options, setOptions] = useState<Option[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [failed, setFailed] = useState(false);
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Debounced lookup; a newer keystroke cancels the in-flight request.
  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/discovery/suggest?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { data: Suggestions };
        setOptions(toOptions(body.data));
        setFailed(false);
        setActive(-1);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setFailed(true);
      }
    }, 220);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [value]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const shown = value.trim().length >= 2 ? options : [];
  const expanded = open && (shown.length > 0 || failed);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && shown.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % shown.length);
    } else if (e.key === "ArrowUp" && shown.length) {
      e.preventDefault();
      setActive((i) => (i <= 0 ? shown.length - 1 : i - 1));
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    } else if (e.key === "Enter" && expanded && active >= 0 && shown[active]) {
      e.preventDefault();
      window.location.assign(shown[active].href);
    }
  }

  return (
    <div ref={root} data-own-search={primary ? "" : undefined} className={cn("relative", className)}>
      <form ref={formRef} action={action} method="get" role="search">
        {locality ? <input type="hidden" name="locality" value={locality} /> : null}
        <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <label htmlFor={`${listId}-q`} className="sr-only">
            Search NationX
          </label>
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={input}
            id={`${listId}-q`}
            name="q"
            type="search"
            role="combobox"
            aria-expanded={expanded}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `${listId}-o${active}` : undefined}
            value={value}
            maxLength={80}
            autoComplete="off"
            enterKeyHint="search"
            autoFocus={autoFocus}
            placeholder={placeholder}
            onChange={(e) => {
              setValue(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            className={cn(
              "w-full rounded-xl border border-input bg-card pr-3 pl-11 text-base shadow-card transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40",
              size === "lg" ? "h-12" : "h-10",
            )}
          />
        </div>
        <button
          type="submit"
          className={cn(
            "shrink-0 rounded-xl bg-primary px-5 text-base font-medium text-primary-foreground transition-colors outline-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50",
            size === "lg" ? "h-12" : "h-10 px-4 text-sm",
          )}
        >
          {buttonLabel}
        </button>
        </div>
        {children}
      </form>

      {expanded ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Suggestions"
          className="absolute z-50 mt-2 max-h-80 w-full overflow-auto rounded-xl border bg-popover p-1 shadow-lift"
        >
          {shown.map((o, i) => {
            const Icon = ICONS[o.kind];
            return (
              <li key={o.key} role="presentation">
                <Link
                  id={`${listId}-o${i}`}
                  role="option"
                  aria-selected={i === active}
                  href={o.href}
                  onClick={() => setOpen(false)}
                  className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm outline-none", i === active ? "bg-muted" : "hover:bg-muted")}
                >
                  <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{o.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{o.hint}</span>
                  </span>
                </Link>
              </li>
            );
          })}
          {failed && shown.length === 0 ? <li className="px-3 py-2.5 text-sm text-muted-foreground">Suggestions are unavailable. Press Search to continue.</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
