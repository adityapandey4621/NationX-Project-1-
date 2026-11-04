import Link from "next/link";
import { cn } from "@/lib/utils";

/** The NationX mark: two crossing strokes (an X) in the brand green and marigold. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8 shrink-0", className)}>
      <rect width="32" height="32" rx="9" className="fill-primary" />
      <path d="M9 9 L23 23" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" className="text-primary-foreground" />
      <path d="M23 9 L9 23" stroke="var(--marigold)" strokeWidth="3.4" strokeLinecap="round" />
    </svg>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <Link href="/" aria-label="NationX home" className={cn("inline-flex items-center gap-2 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50", className)}>
      <BrandMark />
      <span className="font-heading text-xl font-bold tracking-tight">
        Nation<span className="text-primary">X</span>
      </span>
    </Link>
  );
}
