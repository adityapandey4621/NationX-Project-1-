import type { Metadata } from "next";
import QRCode from "qrcode";
import { Download, Smartphone } from "lucide-react";
import { InstallButton } from "@/components/site/install-button";
import { buttonVariants } from "@/components/ui/button";
import { getT } from "@/i18n/server";
import { siteConfig } from "@/lib/site-config";
import { siteOrigin } from "@/server/site-origin";

export const metadata: Metadata = { title: "Get the app", description: "Install NationX on your phone: opens like an app, loads fast, uses little data." };

export default async function GetAppPage() {
  const t = await getT();
  const url = `${await siteOrigin()}/app`;
  const qr = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0b1f1a", light: "#ffffff" } });
  const { androidApkUrl, playStoreUrl, appStoreUrl } = siteConfig;
  const hasStore = Boolean(androidApkUrl || playStoreUrl || appStoreUrl);

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-10 sm:py-14">
      <div className="flex items-start gap-4">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><Smartphone aria-hidden className="size-7" /></span>
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-balance">{t("app.title")}</h1>
          <p className="text-foreground/75">{t("app.intro")}</p>
        </div>
      </div>

      <ul className="grid gap-2 text-sm text-foreground/80 sm:grid-cols-3">
        {t("app.points").split("|").map((p) => (
          <li key={p} className="rounded-xl border bg-card px-3 py-2 shadow-card">{p}</li>
        ))}
      </ul>

      <section className="space-y-4 rounded-2xl border bg-card p-5 shadow-card">
        <InstallButton labels={{ install: t("app.install"), installed: t("app.installed"), ios: t("app.ios"), manual: t("app.manual") }} />
      </section>

      {hasStore ? (
        <ul className="flex flex-wrap gap-3">
          {androidApkUrl ? <li><a href={androidApkUrl} className={buttonVariants({ variant: "outline", size: "lg" })}><Download aria-hidden className="size-5" /> {t("app.apk")}</a></li> : null}
          {playStoreUrl ? <li><a href={playStoreUrl} className={buttonVariants({ variant: "outline", size: "lg" })}>{t("app.play")}</a></li> : null}
          {appStoreUrl ? <li><a href={appStoreUrl} className={buttonVariants({ variant: "outline", size: "lg" })}>{t("app.appstore")}</a></li> : null}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("app.noStore")}</p>
      )}

      <section className="flex flex-wrap items-center gap-5 rounded-2xl border bg-card p-5 shadow-card">
        <div role="img" aria-label={`QR code linking to ${url}`} className="size-36 shrink-0 [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: qr }} />
        <p className="max-w-xs text-sm text-foreground/75">{t("app.scan")}</p>
      </section>
    </div>
  );
}