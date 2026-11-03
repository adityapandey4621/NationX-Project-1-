import { PageHeader } from "@/components/marketplace/page-header";

/** Shared layout for About / Contact / Privacy / Terms: breadcrumb band plus a readable column. */
export function InfoPage({
  title,
  description,
  draftNotice,
  children,
}: {
  title: string;
  description?: string;
  /** Shown on legal pages that have not yet had legal review. */
  draftNotice?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <PageHeader title={title} description={description} />
      <div className="mx-auto max-w-3xl space-y-8 px-4 py-10 sm:py-14">
        {draftNotice ? (
          <p role="note" className="rounded-xl border border-marigold/40 bg-warning-soft px-4 py-3 text-sm">
            {draftNotice}
          </p>
        ) : null}
        <div className="space-y-8 text-[17px] leading-relaxed text-foreground/85 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_ul]:space-y-1.5 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4">
          {children}
        </div>
      </div>
    </div>
  );
}