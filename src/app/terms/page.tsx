import type { Metadata } from "next";
import { InfoPage } from "@/components/marketplace/info-page";

export const metadata: Metadata = { title: "Terms of use", description: "The ground rules for using NationX." };

const DRAFT = "Draft v0.1. It has not yet been reviewed by a lawyer and must be before launch.";

export default function TermsPage() {
  return (
    <InfoPage title="Terms of use" description="Plain-language ground rules." draftNotice={DRAFT}>
      <section>
        <h2>What NationX is</h2>
        <p>
          NationX is a directory. Shops list themselves after our review. We do not sell the goods or services listed, and today you buy directly from the shop, so any purchase is between you and
          the shop.
        </p>
      </section>
      <section>
        <h2>Information on shop pages</h2>
        <p>
          Shops provide their own details, hours, items and prices. Where something is unconfirmed we say so, so please call to confirm before you travel or pay. We check shops before they are
          listed, but we cannot guarantee that every detail is current.
        </p>
      </section>
      <section>
        <h2>Shop owners</h2>
        <ul>
          <li>Give true information and keep it up to date.</li>
          <li>You may list only a business you are authorised to represent.</li>
          <li>We may ask for corrections, hide a listing, or remove it if it breaks these rules or misleads customers.</li>
        </ul>
      </section>
      <section>
        <h2>Everyone</h2>
        <ul>
          <li>Do not misuse the site, attempt to break it, or post unlawful or misleading content.</li>
          <li>We may change or pause the service as it develops.</li>
        </ul>
      </section>
    </InfoPage>
  );
}