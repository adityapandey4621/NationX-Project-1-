import {
  Apple,
  BookOpen,
  Hammer,
  Laptop,
  Pill,
  Scissors,
  Shirt,
  ShoppingBasket,
  Sparkles,
  Store,
  UtensilsCrossed,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * Marketplace presentation registry (ADR-009).
 *
 * The database decides WHICH categories exist and which of four storefront
 * templates each one uses (`categories.default_template`). This module decides
 * only HOW they look:
 *
 *  - `TEMPLATES`  — one entry per template: wording and which facts a card or page
 *                   highlights. Components read this map; they never branch on a
 *                   category name.
 *  - `CATEGORY_RULES` — ordered keyword rules that pick an icon + colour tone from
 *                   a category slug. A brand-new category matches no rule and falls
 *                   back to its template's default, so adding one needs no code.
 *
 * To give a new category its own icon, add one line to CATEGORY_RULES.
 */

export const TEMPLATE_KEYS = ["standard_retail", "grocery", "service_provider", "artisan"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/** Static class strings so Tailwind can see them. `chip` = tinted icon background, `edge` = cover placeholder. */
export const TONES = {
  green: { chip: "bg-emerald-100 text-emerald-900", edge: "from-emerald-100 to-emerald-50", dot: "bg-emerald-500" },
  marigold: { chip: "bg-amber-100 text-amber-900", edge: "from-amber-100 to-amber-50", dot: "bg-amber-500" },
  terracotta: { chip: "bg-orange-100 text-orange-900", edge: "from-orange-100 to-orange-50", dot: "bg-orange-500" },
  teal: { chip: "bg-teal-100 text-teal-900", edge: "from-teal-100 to-teal-50", dot: "bg-teal-500" },
  olive: { chip: "bg-lime-100 text-lime-900", edge: "from-lime-100 to-lime-50", dot: "bg-lime-600" },
  rose: { chip: "bg-rose-100 text-rose-900", edge: "from-rose-100 to-rose-50", dot: "bg-rose-500" },
} as const;
export type ToneKey = keyof typeof TONES;

export interface TemplatePresentation {
  /** Heading above a shop's items on its storefront. */
  itemsHeading: string;
  /** Singular / plural noun for a listed entry. */
  itemNoun: [singular: string, plural: string];
  /** Whether a stock label is meaningful for this kind of business (services have no stock). */
  showStock: boolean;
  /** Which fact a business card leads with. */
  cardHighlight: "items" | "models";
  /** Default icon + tone when no category rule matches. */
  icon: LucideIcon;
  tone: ToneKey;
}

export const TEMPLATES: Record<TemplateKey, TemplatePresentation> = {
  grocery: { itemsHeading: "On the shelf", itemNoun: ["item", "items"], showStock: true, cardHighlight: "items", icon: ShoppingBasket, tone: "green" },
  standard_retail: { itemsHeading: "Products", itemNoun: ["product", "products"], showStock: true, cardHighlight: "items", icon: Store, tone: "marigold" },
  service_provider: { itemsHeading: "Services", itemNoun: ["service", "services"], showStock: false, cardHighlight: "models", icon: Wrench, tone: "teal" },
  artisan: { itemsHeading: "Specialities", itemNoun: ["speciality", "specialities"], showStock: true, cardHighlight: "items", icon: Sparkles, tone: "terracotta" },
};

interface CategoryRule {
  /** Matched against the category slug. */
  match: RegExp;
  icon: LucideIcon;
  tone: ToneKey;
}

/** First match wins. Order from most to least specific. */
const CATEGORY_RULES: readonly CategoryRule[] = [
  { match: /fruit|vegetable|produce|greens/, icon: Apple, tone: "olive" },
  { match: /kirana|grocer|supermarket|provision/, icon: ShoppingBasket, tone: "green" },
  { match: /restaurant|food|cafe|bakery|sweet|tiffin|hotel/, icon: UtensilsCrossed, tone: "terracotta" },
  { match: /pharma|medic|health|chemist|wellness/, icon: Pill, tone: "teal" },
  { match: /hardware|tool|paint|building/, icon: Hammer, tone: "marigold" },
  { match: /electric|wiring|electrician/, icon: Zap, tone: "marigold" },
  { match: /electronic|mobile|computer|appliance/, icon: Laptop, tone: "teal" },
  { match: /salon|beauty|spa|barber|parlour|parlor/, icon: Scissors, tone: "rose" },
  { match: /fashion|cloth|garment|tailor|textile|saree|apparel/, icon: Shirt, tone: "rose" },
  { match: /book|stationer|school|print/, icon: BookOpen, tone: "olive" },
];

export interface CategoryPresentation {
  icon: LucideIcon;
  tone: (typeof TONES)[ToneKey];
  toneKey: ToneKey;
}

/** Icon + colour for a category, derived from its slug with a template-level fallback. */
export function presentCategory(slug: string, template: TemplateKey = "standard_retail"): CategoryPresentation {
  const rule = CATEGORY_RULES.find((r) => r.match.test(slug.toLowerCase()));
  const base = TEMPLATES[template] ?? TEMPLATES.standard_retail;
  const toneKey = rule?.tone ?? base.tone;
  return { icon: rule?.icon ?? base.icon, tone: TONES[toneKey], toneKey };
}

/** Wording / layout switches for a storefront template. Unknown values fall back to standard retail. */
export function presentTemplate(template: string | null | undefined): TemplatePresentation {
  return TEMPLATES[(template ?? "standard_retail") as TemplateKey] ?? TEMPLATES.standard_retail;
}
