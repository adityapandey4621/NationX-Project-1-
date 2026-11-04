import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { InstallBanner } from "@/components/site/install-banner";
import { PwaRegister } from "@/components/site/pwa-register";
import { getLocale, getT } from "@/i18n/server";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import "./globals.css";

// Fonts are SELF-HOSTED from npm packages (@fontsource*), not fetched from Google at build time. A build therefore
// never depends on Google being reachable (it did before, and failed intermittently), no visitor IP is sent to a
// third party (DPDP-friendly), and the exact font versions are pinned in package-lock.json.
// next/font/local only accepts explicitly written literals, so every path is spelled out in full.
const geistSans = localFont({
  variable: "--font-geist-sans",
  src: "../../node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2",
  weight: "100 900",
  display: "swap",
});

const geistMono = localFont({
  variable: "--font-geist-mono",
  src: "../../node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2",
  weight: "100 900",
  display: "swap",
});

// Headings: Plus Jakarta Sans reads as steady and professional (a shop owner is trusting us with
// their business), while staying friendly. Body text stays in Geist for legibility on small screens.
const display = localFont({
  variable: "--font-display",
  src: [
    { path: "../../node_modules/@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../../node_modules/@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "../../node_modules/@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-800-normal.woff2", weight: "800", style: "normal" },
  ],
  display: "swap",
});

// Absolute URLs in link previews (WhatsApp, Google) need a base; set NEXT_PUBLIC_SITE_URL in production.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

// Telugu glyphs: the Latin fonts above have none. The face is declared with a Telugu unicode-range, so a page with
// no Telugu never downloads it. The language label is on every page, so a device with no system Telugu font fetches
// the one weight in use (~36 KB, only the weight used); phones with a system Telugu font fetch nothing.
const telugu = localFont({
  variable: "--font-telugu",
  src: [
    { path: "../../node_modules/@fontsource/noto-sans-telugu/files/noto-sans-telugu-telugu-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../../node_modules/@fontsource/noto-sans-telugu/files/noto-sans-telugu-telugu-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../../node_modules/@fontsource/noto-sans-telugu/files/noto-sans-telugu-telugu-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../../node_modules/@fontsource/noto-sans-telugu/files/noto-sans-telugu-telugu-700-normal.woff2", weight: "700", style: "normal" },
  ],
  declarations: [{ prop: "unicode-range", value: "U+0951-0952,U+0964-0965,U+0C00-0C7F,U+1CDA,U+200C-200D,U+25CC" }],
  display: "swap",
  // No <link rel=preload>: otherwise every English page would download this file too.
  preload: false,
});
export const metadata: Metadata = {
  ...(siteUrl && /^https?:\/\//i.test(siteUrl) ? { metadataBase: new URL(siteUrl) } : {}),
  applicationName: "NationX",
  icons: { apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "NationX", statusBarStyle: "default" },
  title: { default: "NationX · Local shops and services in Khammam", template: "%s · NationX" },
  description: "Discover local shops and services in Khammam, browse their storefronts, and ask us to find what you cannot.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0F766E",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [locale, t] = await Promise.all([getLocale(), getT()]);
  return (
    <html lang={locale}>
      <body className={`${geistSans.variable} ${geistMono.variable} ${display.variable} ${telugu.variable} flex min-h-dvh flex-col antialiased`}>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">
          Skip to content
        </a>
        <SiteHeader />
        <InstallBanner labels={{ text: t("banner.text"), install: t("banner.install"), close: t("banner.close") }} />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
        <PwaRegister />
      </body>
    </html>
  );
}
