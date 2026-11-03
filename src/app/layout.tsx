import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Noto_Sans_Telugu, Plus_Jakarta_Sans } from "next/font/google";
import { PwaRegister } from "@/components/site/pwa-register";
import { getLocale } from "@/i18n/server";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Headings: Plus Jakarta Sans reads as steady and professional (a shop owner is trusting us with
// their business), while staying friendly. Body text stays in Geist for legibility on small screens.
const display = Plus_Jakarta_Sans({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

// Absolute URLs in link previews (WhatsApp, Google) need a base; set NEXT_PUBLIC_SITE_URL in production.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

// Telugu glyphs: the Latin fonts above have none. Subsets are fetched only when a page contains Telugu the device
// cannot draw itself (unicode-range). The language label is on every page, so a device with no Telugu font fetches
// one ~16 KB subset even on English pages (measured); phones with a system Telugu font fetch nothing.
const telugu = Noto_Sans_Telugu({
  variable: "--font-telugu",
  subsets: ["telugu"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  // No <link rel=preload>: otherwise every English page would download this file too. With unicode-range the
  // browser fetches it only when a page actually contains Telugu characters.
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
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body className={`${geistSans.variable} ${geistMono.variable} ${display.variable} ${telugu.variable} flex min-h-dvh flex-col antialiased`}>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
        <PwaRegister />
      </body>
    </html>
  );
}
