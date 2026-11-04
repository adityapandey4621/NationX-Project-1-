import Link from "next/link";
import { Brand } from "@/components/site/brand";
import { loadChrome } from "@/components/site/chrome-data";
import { getT } from "@/i18n/server";
import { siteConfig } from "@/lib/site-config";

const linkCls = "inline-block rounded py-2 text-sm text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <nav aria-label={title}>
      <h2 className="font-heading text-sm font-semibold">{title}</h2>
      <ul className="mt-2 space-y-0.5">{children}</ul>
    </nav>
  );
}

/** Organised footer. Contact, legal and social entries appear only when configured (lib/site-config). */
export async function SiteFooter() {
  const [{ categories }, t] = await Promise.all([loadChrome(), getT()]);
  const { contactEmail, contactPhone, privacyUrl, termsUrl, social } = siteConfig;
  const hasContact = Boolean(contactEmail || contactPhone);

  return (
    <footer className="mt-20 border-t bg-secondary/50">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1.2fr]">
        <div className="space-y-3 sm:col-span-2 lg:col-span-1">
          <Brand />
          <p className="max-w-xs text-sm text-muted-foreground">
            NationX helps people in {siteConfig.region} discover local shops and services. Businesses are reviewed by our team before their page goes live.
          </p>
        </div>

        <Column title={t("footer.customers")}>
          <li><Link href="/explore" className={linkCls}>{t("footer.explore")}</Link></li>
          <li><Link href="/search" className={linkCls}>{t("footer.search")}</Link></li>
          <li><Link href="/help-me-find-it" className={linkCls}>{t("footer.helpMe")}</Link></li>
          <li><Link href="/help-me-find-it/track" className={linkCls}>{t("footer.track")}</Link></li>
          <li><Link href="/account/requests" className={linkCls}>{t("footer.myRequests")}</Link></li>
          <li><Link href="/app" className={linkCls}>{t("footer.app")}</Link></li>
        </Column>

        <Column title={t("footer.businesses")}>
          <li><Link href="/sell" className={linkCls}>{t("footer.sell")}</Link></li>
          <li><Link href="/merchant/apply" className={linkCls}>{t("footer.addShop")}</Link></li>
          <li><Link href="/merchant" className={linkCls}>{t("footer.dashboard")}</Link></li>
          <li><Link href="/sign-in" className={linkCls}>{t("footer.signIn")}</Link></li>
        </Column>

        <Column title={t("footer.categories")}>
          {categories.slice(0, 7).map((c) => (
            <li key={c.id}>
              <Link href={`/category/${c.slug}`} className={linkCls}>{c.name}</Link>
            </li>
          ))}
          {categories.length === 0 ? <li className="py-1 text-sm text-muted-foreground">Categories appear as stores join.</li> : null}
        </Column>

        <div className="space-y-6">
          <Column title={t("footer.help")}>
            <li><Link href="/help-me-find-it" className={linkCls}>{t("footer.askUs")}</Link></li>
            <li><Link href="/waitlist" className={linkCls}>{t("footer.waitlist")}</Link></li>
            <li><Link href="/about" className={linkCls}>{t("footer.about")}</Link></li>
            <li><Link href="/contact" className={linkCls}>{t("footer.contact")}</Link></li>
            {contactEmail ? <li><a href={`mailto:${contactEmail}`} className={linkCls}>{contactEmail}</a></li> : null}
            {contactPhone ? <li><a href={`tel:${contactPhone.replace(/\s+/g, "")}`} className={linkCls}>{contactPhone}</a></li> : null}
            {hasContact ? null : <li className="py-1 text-sm text-muted-foreground">Direct support contacts are not published yet.</li>}
          </Column>
          {social.length > 0 ? (
            <Column title="Follow us">
              {social.map((s) => (
                <li key={s.label}>
                  <a href={s.href} target="_blank" rel="noopener noreferrer" className={linkCls}>{s.label}</a>
                </li>
              ))}
            </Column>
          ) : null}
        </div>
      </div>

      <div className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-4 text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} NationX · {siteConfig.region}</p>
          <p className="flex flex-wrap gap-x-4">
            {/* A configured external URL (reviewed legal text) wins over the built-in draft pages. */}
            {privacyUrl ? <a href={privacyUrl} className="hover:underline">{t("footer.privacy")}</a> : <Link href="/privacy" className="hover:underline">{t("footer.privacy")}</Link>}
            {termsUrl ? <a href={termsUrl} className="hover:underline">{t("footer.terms")}</a> : <Link href="/terms" className="hover:underline">{t("footer.terms")}</Link>}
          </p>
        </div>
      </div>
    </footer>
  );
}
