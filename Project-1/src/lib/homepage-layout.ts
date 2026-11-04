import { createElement, Fragment, type ReactNode } from "react";

/**
 * Which sections appear below the homepage hero, and in what order (REQ-HOM-07). The hero is fixed. The settings are
 * data (Admin, Homepage), so a change needs no deployment. Hiding a section only hides it: it never makes up content,
 * and a section with nothing to show renders nothing whether it is visible or not.
 */
export const HOME_SECTION_KEYS = ["banners", "featured", "categories", "stores", "items", "community", "areas"] as const;
export type HomeSectionKey = (typeof HOME_SECTION_KEYS)[number];

export const HOME_SECTION_LABELS: Record<HomeSectionKey, { label: string; description: string }> = {
  banners: { label: "Announcements", description: "The banners you add below." },
  featured: { label: "Featured stores", description: "The shops you feature below." },
  categories: { label: "Categories", description: "Category tiles." },
  stores: { label: "Stores", description: "Recently added stores near the chosen area." },
  items: { label: "Items", description: "A sample of items shops have listed." },
  community: { label: "Community counts", description: "Real counts of shops and the area waitlist." },
  areas: { label: "Areas", description: "Links to each area." },
};

export interface HomeSectionSetting {
  section_key: string;
  is_visible: boolean;
  display_order: number;
}

export interface ResolvedSection {
  key: HomeSectionKey;
  visible: boolean;
  order: number;
}

const DEFAULT_ORDER: Record<HomeSectionKey, number> = Object.fromEntries(HOME_SECTION_KEYS.map((k, i) => [k, (i + 1) * 10])) as Record<HomeSectionKey, number>;

const isKey = (k: string): k is HomeSectionKey => (HOME_SECTION_KEYS as readonly string[]).includes(k);

/**
 * Turn the saved settings into the order to render. Unknown keys are ignored; a section with no saved row is shown
 * at its default place, so a missing or empty table can never blank the homepage. Ties keep the default order.
 */
export function resolveHomeLayout(settings: readonly HomeSectionSetting[] | null | undefined): ResolvedSection[] {
  const saved = new Map<HomeSectionKey, HomeSectionSetting>();
  for (const s of settings ?? []) if (isKey(s.section_key)) saved.set(s.section_key, s);
  return HOME_SECTION_KEYS.map((key) => {
    const s = saved.get(key);
    return { key, visible: s ? s.is_visible : true, order: s ? s.display_order : DEFAULT_ORDER[key] };
  }).sort((a, b) => a.order - b.order || DEFAULT_ORDER[a.key] - DEFAULT_ORDER[b.key]);
}

/** The visible sections' content, in layout order. DOM order is the reading and tab order, so this really reorders. */
export function renderHomeSections(layout: readonly ResolvedSection[], nodes: Record<HomeSectionKey, ReactNode>): ReactNode[] {
  return layout.filter((s) => s.visible).map((s) => createElement(Fragment, { key: s.key }, nodes[s.key]));
}
