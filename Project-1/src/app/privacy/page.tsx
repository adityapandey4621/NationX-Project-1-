import type { Metadata } from "next";
import { InfoPage } from "@/components/marketplace/info-page";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = { title: "Privacy", description: "What NationX collects, why, and how you control it." };

const DRAFT =
  "Draft v0.1, written to describe what the software does today. It has not yet been reviewed by a lawyer, and the controller details and grievance contact below must be completed before launch.";

export default function PrivacyPage() {
  return (
    <InfoPage title="Privacy" description="What we collect, why, and the choices you have." draftNotice={DRAFT}>
      <section>
        <h2>Browsing</h2>
        <p>You can search and browse shops without an account. We do not run advertising trackers or sell data.</p>
      </section>
      <section>
        <h2>Your location (optional)</h2>
        <p>
          &ldquo;Use my location&rdquo; asks your browser for permission only when you tap it. We round the position to roughly 100 metres, keep it in a cookie on your device for 2 hours, and send it
          to our server only to work out how far shops are. We do not save it in our database. You can stop at any time with &ldquo;Stop using my location&rdquo;, and refusing never blocks the
          site: you can pick your area manually.
        </p>
      </section>
      <section>
        <h2>Cookies we set</h2>
        <ul>
          <li>Your chosen area (so the site remembers it).</li>
          <li>Your optional shared position, described above.</li>
          <li>A sign-in session if you create an account.</li>
        </ul>
      </section>
      <section>
        <h2>Accounts and requests</h2>
        <ul>
          <li>Account: email, name and phone you give us, so you can sign in and so shops and our team can reach you about your request.</li>
          <li>Help me find it: what you asked for, your area, and the contact details you chose to share. These are seen by our team and used only to answer the request.</li>
          <li>Shop owners: the business details in the application. Public shop pages show only the details a shop publishes.</li>
        </ul>
      </section>
      <section>
        <h2>Your choices</h2>
        <p>You can ask us to correct or delete your personal data, or withdraw consent you gave us, using the contact below.</p>
      </section>
      <section>
        <h2>Contact for privacy questions</h2>
        <p>
          {siteConfig.contactEmail ? <a href={`mailto:${siteConfig.contactEmail}`}>{siteConfig.contactEmail}</a> : "To be published before launch."}
        </p>
      </section>
    </InfoPage>
  );
}