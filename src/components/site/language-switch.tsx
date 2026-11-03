import { LOCALES, LOCALE_LABEL, type Locale } from "@/i18n/config";
import { setLanguageAction } from "@/server/actions/language";
import { cn } from "@/lib/utils";

/**
 * The label "తెలుగు" is on every page. Using the device's own font first means English visitors whose phone can
 * already draw Telugu never download the Telugu web font; the web font is only the last-resort fallback.
 */
const LABEL_FONT = { fontFamily: "system-ui, sans-serif, var(--font-telugu)" } as const;

/**
 * English / Telugu toggle. A plain form (works without JavaScript); `next` returns the visitor to the
 * page they were on. The current language is marked with aria-current and is not a button.
 */
export function LanguageSwitch({ current, label, className }: { current: Locale; label: string; className?: string }) {
  return (
    <form action={setLanguageAction} aria-label={label} className={cn("inline-flex items-center rounded-xl border bg-card p-0.5 text-sm shadow-card", className)}>
      {LOCALES.map((l) =>
        l === current ? (
          <span key={l} aria-current="true" lang={l} style={LABEL_FONT} className="rounded-lg bg-primary px-2.5 py-1 font-medium text-primary-foreground">
            {LOCALE_LABEL[l]}
          </span>
        ) : (
          <button key={l} type="submit" name="lang" value={l} lang={l} style={LABEL_FONT} className="rounded-lg px-2.5 py-1 font-medium text-foreground/80 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50">
            {LOCALE_LABEL[l]}
          </button>
        ),
      )}
    </form>
  );
}