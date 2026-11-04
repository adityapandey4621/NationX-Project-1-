import type { Metadata } from "next";
import Link from "next/link";
import { InfoPage } from "@/components/marketplace/info-page";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = { title: "About NationX", description: "What NationX is, how shops get listed, and what we will not do." };

export default function AboutPage() {
  return (
    <InfoPage title="About NationX" description={`A local directory for ${siteConfig.region}, built with shopkeepers, not around them.`}>
      <section>
        <h2>What it is</h2>
        <p>
          NationX helps people in {siteConfig.region} find shops and services close to them, and helps local shopkeepers be found without building a website. You search,
          you see what a shop lists, and you call, message or visit them directly.
        </p>
      </section>
      <section>
        <h2>How a shop gets listed</h2>
        <ul>
          <li>The owner applies with their shop details.</li>
          <li>Our team reviews the application. We may ask for corrections.</li>
          <li>Only after approval does the shop get its public page. We never create a shop page on someone&apos;s behalf.</li>
        </ul>
      </section>
      <section>
        <h2>What we will not do</h2>
        <ul>
          <li>We do not invent ratings, reviews, prices, stock or delivery times. If a shop has not confirmed something, we say &ldquo;Call to confirm&rdquo;.</li>
          <li>We do not take a cut of what you buy: today you deal with the shop directly.</li>
          <li>We do not sell your contact details.</li>
        </ul>
      </section>
      <section>
        <h2>Where we are today</h2>
        <p>
          NationX is early. Some areas have shops and some do not yet. We would rather show an empty area honestly than fill it with fake listings. If you can&apos;t find something,{" "}
          <Link href="/help-me-find-it">ask us</Link>, and if you run a shop, <Link href="/sell">list it</Link>.
        </p>
      </section>
    </InfoPage>
  );
}