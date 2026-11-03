import { cn } from "@/lib/utils";
import { presentCategory, type TemplateKey } from "@/lib/marketplace/presentation";

/** Tinted icon for a category. Icon and colour come from the presentation registry, never from the caller. */
export function CategoryIcon({
  slug,
  template,
  className,
  iconClassName,
}: {
  slug: string;
  template?: TemplateKey | undefined;
  className?: string | undefined;
  iconClassName?: string | undefined;
}) {
  const { icon: Icon, tone } = presentCategory(slug, template);
  return (
    <span aria-hidden className={cn("inline-flex size-11 shrink-0 items-center justify-center rounded-xl", tone.chip, className)}>
      <Icon className={cn("size-5", iconClassName)} strokeWidth={1.75} />
    </span>
  );
}
