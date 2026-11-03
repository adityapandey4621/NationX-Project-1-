import type { Metadata } from "next";
import Link from "next/link";
import { InfoPage } from "@/components/marketplace/info-page";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = { title: "Contact", description: "How to reach the NationX team." };

export default function ContactPage() {
  const { contactEmail, contactPhone } = siteConfig;
  return (
    <InfoPage title="Contact" description="We read everything that comes in.">
      <section>
        <h2>Looking for something?</h2>
        <p>
          Use <Link href="/help-me-find-it">Help me find it</Link>. Tell us what you need and where, and our team looks for a shop. You can{" "}
          <Link href="/help-me-find-it/track">track the request</Link> afterwards.
        </p>
      </section>
      <section>
        <h2>Running a shop?</h2>
        <p>
          <Link href="/sell">See how listing works</Link> or <Link href="/merchant/apply">apply now</Link>. If you have already applied, your dashboard shows the status and any
          corrections we asked for.
        </p>
      </section>
      <section>
        <h2>Talk to us</h2>
        {contactEmail || contactPhone ? (
          <ul>
            {contactEmail ? <li>Email: <a href={`mailto:${contactEmail}`}>{contactEmail}</a></li> : null}
            {contactPhone ? <li>Phone: <a href={`tel:${contactPhone.replace(/\s+/g, "")}`}>{contactPhone}</a></li> : null}
          </ul>
        ) : (
          <p>Direct contact details have not been published yet. Until then, Help me find it and the shop application are the best ways to reach us.</p>
        )}
      </section>
    </InfoPage>
  );
}