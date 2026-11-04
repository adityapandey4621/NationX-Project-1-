import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { PrintButton } from "@/components/marketplace/print-button";
import { siteConfig } from "@/lib/site-config";
import { siteOrigin } from "@/server/site-origin";
import { getPublicStorefront } from "@/server/services";
import { createRequestClient } from "@/server/supabase/server";

export const metadata: Metadata = { title: "Shop poster", robots: { index: false } };

/**
 * A printable "Find us on NationX" poster with a QR code to the shop's public page.
 * Only published, visible storefronts have one (everything else is a plain 404).
 */
export default async function PosterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sf = await getPublicStorefront(await createRequestClient(), slug);
  if (!sf) notFound();

  const url = `${await siteOrigin()}/shop/${sf.slug}`;
  // Generated on the server: the page ships an inline SVG and no QR library to the browser.
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0b1f1a", light: "#ffffff" } });

  return (
    <div className="mx-auto max-w-xl space-y-6 px-4 py-10 print:max-w-none print:py-0">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href={`/shop/${sf.slug}`} className="text-sm font-medium text-primary underline underline-offset-4">
          Back to {sf.shop.name}
        </Link>
        <PrintButton />
      </div>

      <section aria-label="Poster" className="space-y-6 rounded-3xl border-2 bg-white p-8 text-center text-neutral-900 shadow-card print:rounded-none print:border-0 print:shadow-none">
        <p className="text-sm font-semibold tracking-widest text-neutral-500 uppercase">Find us on {siteConfig.name}</p>
        <h1 className="text-4xl leading-tight font-bold text-balance">{sf.shop.name}</h1>
        <p className="text-neutral-600">
          {sf.shop.category.name} · {sf.shop.locality.name}
        </p>
        <div role="img" aria-label={`QR code linking to ${url}`} className="mx-auto size-64 [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />
        <p className="text-lg font-medium">Scan to see our items, hours and directions</p>
        <p className="text-sm break-all text-neutral-500">{url}</p>
      </section>
    </div>
  );
}