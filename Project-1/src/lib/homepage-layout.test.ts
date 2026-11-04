import { describe, expect, it } from "vitest";
import { HOME_SECTION_KEYS, renderHomeSections, resolveHomeLayout } from "./homepage-layout";

describe("resolveHomeLayout", () => {
  it("falls back to every section, visible, in the default order when nothing is saved", () => {
    for (const empty of [null, undefined, []]) {
      const l = resolveHomeLayout(empty);
      expect(l.map((s) => s.key)).toEqual([...HOME_SECTION_KEYS]);
      expect(l.every((s) => s.visible)).toBe(true);
    }
  });
  it("orders by the saved order and honours hidden sections", () => {
    const l = resolveHomeLayout([
      { section_key: "areas", is_visible: true, display_order: 5 },
      { section_key: "items", is_visible: false, display_order: 55 },
    ]);
    expect(l[0]?.key).toBe("areas");
    expect(l.find((s) => s.key === "items")?.visible).toBe(false);
  });
  it("a section with no saved row keeps its default place and stays visible", () => {
    const l = resolveHomeLayout([{ section_key: "banners", is_visible: false, display_order: 900 }]);
    expect(l.at(-1)?.key).toBe("banners");
    expect(l.filter((s) => s.visible)).toHaveLength(HOME_SECTION_KEYS.length - 1);
    expect(l.slice(0, 2).map((s) => s.key)).toEqual(["featured", "categories"]);
  });
  it("ignores keys it does not know instead of rendering or failing on them", () => {
    const l = resolveHomeLayout([{ section_key: "hero", is_visible: false, display_order: 0 }, { section_key: "<script>", is_visible: true, display_order: 1 }]);
    expect(l.map((s) => s.key)).toEqual([...HOME_SECTION_KEYS]);
  });
  it("ties keep the default order", () => {
    const l = resolveHomeLayout(HOME_SECTION_KEYS.map((k) => ({ section_key: k, is_visible: true, display_order: 10 })));
    expect(l.map((s) => s.key)).toEqual([...HOME_SECTION_KEYS]);
  });
});

describe("renderHomeSections", () => {
  const nodes = Object.fromEntries(HOME_SECTION_KEYS.map((k) => [k, `node-${k}`])) as Record<(typeof HOME_SECTION_KEYS)[number], string>;
  it("returns only the visible sections, keyed, in layout order", () => {
    const out = renderHomeSections(
      resolveHomeLayout([
        { section_key: "areas", is_visible: true, display_order: 1 },
        { section_key: "stores", is_visible: false, display_order: 40 },
      ]),
      nodes,
    ) as { key: string; props: { children: string } }[];
    expect(out.map((e) => e.key)).toEqual(["areas", "banners", "featured", "categories", "items", "community"]);
    expect(out[0]?.props.children).toBe("node-areas");
  });
});
