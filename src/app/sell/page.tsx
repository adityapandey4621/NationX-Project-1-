import type { Metadata } from "next";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { ArrowRight, BadgeCheck, ClipboardCheck, Link2, MapPin, MessageCircle, Phone, ShieldCheck, Store } from "lucide-react";
import { SectionHeading } from "@/components/marketplace/section-heading";
import { buttonVariants } from "@/components/ui/button";
import { isSupabaseConfigured } from "@/server/config/env";
import { getT } from "@/i18n/server";
import { listActiveCategories, listWaitlistDemand, visibleDemand } from "@/server/services";
import { createRequestClient } from "@/server/supabase/server";

export const metadata: Metadata = {
  title: "Sell on NationX",
  description: "Get your shop found by people nearby. Apply, get verified, and receive a public page automatically.",
};

const STEPS = [
  { icon: ClipboardCheck, title: "Apply", body: "Tell us about your shop: name, category, address, hours, contact and a few photos. It takes a few minutes and works on a phone." },
  { icon: ShieldCheck, title: "We verify", body: "Our team reviews every application. If something needs fixing we tell you exactly what, and you can resubmit." },
  { icon: Store, title: "Your page goes live", body: "Once approved, your shop gets its own public page and link automatically. Nobody has to build anything." },
  { icon: BadgeCheck, title: "You stay in control", body: "Update your hours, items and photos from your dashboard whenever you like. You decide what is shown." },
];

const GETS = [
  { icon: Link2, title: "Your own link", body: "A short page for your shop that you can share on WhatsApp, print on a card, or put on your board." },
  { icon: Phone, title: "Calls and WhatsApp", body: "Customers reach you directly with one tap. There is no middleman on the conversation." },
  { icon: MapPin, title: "Found nearby", body: "People searching your category and area see your shop, with directions to your door." },
  { icon: MessageCircle, title: "Honest listings", body: "Items show In stock, Call to confirm or Out of stock. You never have to promise what you haven't checked." },
];

const FAQ = [
  { q: "Do I need a website or an app?", a: "No. Your public page is created for you after approval, and you manage it from your phone or a computer." },
  { q: "Does NationX take a commission?", a: "Not today. Customers call, message or visit you, and pay you directly. If we ever add paid features we will tell you first, and your existing page will not be taken away." },
  { q: "Who can see my phone number and address?", a: "The shop page shows the contact details and address you choose to publish, so customers can reach and find you. Nothing else from your application is public." },
  { q: "How long does approval take?", a: "Every application is read by a person, so it is not instant. You can check the status in your dashboard at any time." },
  { q: "What if my category isn't listed?", a: "Tell us in your application or through Help me find it. New categories are added by our team." },
];

export default async function SellPage() {
  const t = await getT();
  let categories: { id: string; name: string }[] = [];
  // Real demand: areas where at least a few people asked to be told when shops open. Never shown when small.
  let demand: { locality_slug: string; locality_name: string; waiting: number }[] = [];
  if (isSupabaseConfigured()) {
    try {
      const db = await createRequestClient();
      categories = await listActiveCategories(db);
      demand = visibleDemand(await listWaitlistDemand(db).catch(() => []));
    } catch (e) {
      unstable_rethrow(e);
      console.error("Sell page data failed", e);
    }
  }

  return (
    <div>
      <section aria-labelledby="sell-h" className="border-b bg-brand-soft">
        <div className="mx-auto max-w-4xl space-y-6 px-4 py-12 text-center sm:py-16">
          <p className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-card px-3 py-1 text-xs font-semibold text-primary">For shopkeepers and service providers</p>
          <h1 id="sell-h" className="text-4xl leading-[1.05] font-bold tracking-tight text-balance sm:text-5xl">
            Let your neighbourhood find your shop.
          </h1>
          <p className="mx-auto max-w-2xl text-base text-foreground/75 sm:text-lg">
            Apply once. After we verify you, NationX builds your public page automatically, so people nearby can see what you offer and call, message or visit you.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/merchant/apply" className={buttonVariants({ size: "lg" })}>
              Add your shop <ArrowRight aria-hidden className="size-4" />
            </Link>
            <Link href="#how" className={buttonVariants({ variant: "outline", size: "lg" })}>
              How it works
            </Link>
          </div>
          <p className="text-sm text-muted-foreground">No commission on what customers buy from you today.</p>
        </div>
      </section>

      <div className="mx-auto max-w-5xl space-y-16 px-4 py-12 sm:py-16">
        <section id="how" aria-labelledby="how-h" className="scroll-mt-24 space-y-6">
          <SectionHeading id="how-h" kicker="Four steps" title="From application to a live page" />
          <ol className="grid gap-4 sm:grid-cols-2">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-4 rounded-2xl border bg-card p-5 shadow-card">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-primary">
                  <s.icon aria-hidden className="size-5" />
                </span>
                <div>
                  <h3 className="font-semibold">
                    <span className="text-muted-foreground">{i + 1}.</span> {s.title}
                  </h3>
                  <p className="mt-1 text-sm text-foreground/75">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="gets-h" className="space-y-6">
          <SectionHeading id="gets-h" kicker="What you get" title="Simple tools that do the job" />
          <ul className="grid gap-4 sm:grid-cols-2">
            {GETS.map((g) => (
              <li key={g.title} className="flex gap-4 rounded-2xl border bg-card p-5 shadow-card">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
                  <g.icon aria-hidden className="size-5" />
                </span>
                <div>
                  <h3 className="font-semibold">{g.title}</h3>
                  <p className="mt-1 text-sm text-foreground/75">{g.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {categories.length > 0 ? (
          <section aria-labelledby="who-h" className="space-y-4">
            <SectionHeading id="who-h" kicker="Who it is for" title="Categories we list today" />
            <ul className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <li key={c.id} className="rounded-full border bg-card px-4 py-1.5 text-sm font-medium shadow-card">
                  {c.name}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {demand.length > 0 ? (
          <section aria-labelledby="demand-h" className="space-y-4">
            <SectionHeading id="demand-h" kicker="Real demand" title={t("waitlist.demandTitle")} />
            <ul className="grid gap-3 sm:grid-cols-2">
              {demand.map((d) => (
                <li key={d.locality_slug} className="rounded-2xl border bg-card p-4 shadow-card">
                  {t("waitlist.demand", { n: d.waiting, area: d.locality_name })}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="faq-h" className="space-y-4">
          <SectionHeading id="faq-h" title="Questions shopkeepers ask" />
          <div className="divide-y rounded-2xl border bg-card shadow-card">
            {FAQ.map((f) => (
              <details key={f.q} className="group p-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                  {f.q}
                  <span aria-hidden className="text-xl text-muted-foreground transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-2 text-foreground/75">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="rounded-3xl bg-primary p-8 text-center text-primary-foreground sm:p-12">
          <h2 className="text-3xl font-bold tracking-tight text-balance">Ready to be found?</h2>
          <p className="mx-auto mt-2 max-w-xl text-primary-foreground/85">Create an account, tell us about your shop, and we&apos;ll take it from there.</p>
          <Link href="/merchant/apply" className="mt-6 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-marigold px-5 text-base font-medium text-marigold-foreground outline-none hover:bg-marigold/90 focus-visible:ring-3 focus-visible:ring-ring/50">
            Add your shop <ArrowRight aria-hidden className="size-4" />
          </Link>
        </section>
      </div>
    </div>
  );
}