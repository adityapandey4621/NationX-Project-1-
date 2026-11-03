import Link from "next/link";
import { Brand } from "@/components/site/brand";
import { HeaderSearch } from "@/components/site/header-search";
import { LocationPicker } from "@/components/site/location-picker";
import { MobileNav } from "@/components/site/mobile-nav";
import { loadChrome } from "@/components/site/chrome-data";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { setLocalityAction } from "@/server/actions/discovery";
import { getAuthContext } from "@/server/auth/session";
import { signOutAction } from "@/server/auth/actions";
import { LanguageSwitch } from "@/components/site/language-switch";
import { getLocale, getT } from "@/i18n/server";
import { navItemsForRoles } from "@/server/security/rbac";
import { cn } from "@/lib/utils";

const desktopLink = "rounded-lg px-3 py-2 text-sm font-medium text-foreground/80 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50";
const mobileLink = "rounded-lg px-3 py-3 text-base font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50";

/** Site navigation. Role-specific links are a convenience; routes enforce access server-side. */
export async function SiteHeader() {
  const [ctx, chrome, t, locale] = await Promise.all([getAuthContext(), loadChrome(), getT(), getLocale()]);
  const items = ctx ? navItemsForRoles(ctx.roles) : [];
  const areas = chrome.localities.map((l) => ({ slug: l.slug, name: l.name, district: l.district }));
  const current = chrome.locality ? { slug: chrome.locality.slug, name: chrome.locality.name, district: chrome.locality.district } : null;

  const links = (cls: string) => (
    <>
      <Link href="/explore" className={cls}>
        {t("nav.explore")}
      </Link>
      <Link href="/help-me-find-it" className={cls}>
        {t("nav.help")}
      </Link>
      <Link href="/sell" className={cls}>
        {t("nav.sell")}
      </Link>
      {items.map((item) => (
        <Link key={item.href} href={item.href} className={cls}>
          {item.label}
        </Link>
      ))}
    </>
  );

  return (
    <header className="sticky top-0 z-40 border-b bg-background">
      <div className="relative mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:gap-3">
        <MobileNav openLabel={t("nav.menuOpen")} closeLabel={t("nav.menuClose")}>
          {links(mobileLink)}
          <div className="mt-1 border-t pt-2">
            {ctx ? (
              <>
                <Link href="/account" className={cn(mobileLink, "block")}>
                  {t("nav.account")}
                </Link>
                <form action={signOutAction}>
                  <Button type="submit" variant="outline" size="lg" className="mt-1 w-full">
                    {t("nav.signOut")}
                  </Button>
                </form>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Link href="/sign-in" className={buttonVariants({ variant: "outline", size: "lg" })}>
                  {t("nav.signIn")}
                </Link>
                <Link href="/sign-up" className={buttonVariants({ size: "lg" })}>
                  {t("nav.signUp")}
                </Link>
              </div>
            )}
            <LanguageSwitch current={locale} label={t("lang.label")} className="mt-3" />
          </div>
        </MobileNav>

        <Brand />
        <LocationPicker areas={areas} current={current} action={setLocalityAction} className="ml-auto lg:ml-2" allLabel={t("area.all", { city: areas[0]?.district ?? "" })} />
        <HeaderSearch locality={current?.slug} className="mx-2 hidden max-w-md flex-1 lg:block" placeholder={t("search.placeholder")} buttonLabel={t("search.button")} />

        <nav aria-label="Main" className="ml-auto hidden items-center gap-0.5 lg:flex">
          {links(desktopLink)}
          {ctx ? (
            <>
              <Link href="/account" className={desktopLink}>
                {t("nav.account")}
              </Link>
              <form action={signOutAction}>
                <Button type="submit" variant="outline" size="sm">
                  {t("nav.signOut")}
                </Button>
              </form>
            </>
          ) : (
            <>
              <Link href="/sign-in" className={desktopLink}>
                {t("nav.signIn")}
              </Link>
              <Link href="/sign-up" className={buttonVariants({ size: "sm" })}>
                {t("nav.signUp")}
              </Link>
            </>
          )}
          <LanguageSwitch current={locale} label={t("lang.label")} className="ml-1" />
        </nav>
      </div>
      <HeaderSearch locality={current?.slug} className="mx-4 mb-3 lg:hidden" placeholder={t("search.placeholder")} buttonLabel={t("search.button")} />
    </header>
  );
}
