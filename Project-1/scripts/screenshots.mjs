#!/usr/bin/env node
// Screenshot + layout check of the customer-facing pages at real device sizes.
//
//   node scripts/screenshots.mjs <outDir> [baseUrl]
//
// Run it against `npm run dev:stack -- --prod` (sample data) or any running site.
// For every page and viewport it saves a full-page PNG and reports horizontal
// overflow (a common mobile layout bug) and any browser console errors.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(path.join(root, "package.json"))("playwright");
const out = path.resolve(process.argv[2] ?? "screenshots");
const base = process.argv[3] ?? "http://127.0.0.1:3100";
mkdirSync(out, { recursive: true });

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900, mobile: false },
  { name: "tablet", width: 820, height: 1180, mobile: true },
  { name: "mobile", width: 390, height: 844, mobile: true },
];
const PAGES = (process.env.PAGES ?? "home:/,explore:/explore,search:/search?q=kirana,category:/category/pharmacy,shop:/shop/sample-daily-kirana,service-shop:/shop/sample-glow-salon,help:/help-me-find-it,empty-search:/search?q=zzzzqq,not-found:/shop/nope")
  .split(",")
  .map((p) => {
    const i = p.indexOf(":");
    return { name: p.slice(0, i), url: p.slice(i + 1) };
  });

const browser = await chromium.launch();
let problems = 0;
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: 1 });
  for (const pg of PAGES) {
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    const res = await page.goto(base + pg.url, { waitUntil: "networkidle" });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.screenshot({ path: path.join(out, `${pg.name}-${vp.name}.png`), fullPage: true });
    const bad = overflow > 0 || errors.length > 0;
    if (bad) problems++;
    console.log(`${bad ? "!!" : "ok"} ${vp.name.padEnd(7)} ${pg.name.padEnd(13)} status=${res?.status()} overflow=${overflow}px${errors.length ? ` console=${JSON.stringify(errors.slice(0, 2))}` : ""}`);
    await page.close();
  }
  await ctx.close();
}
await browser.close();
console.log(problems ? `\n${problems} page/viewport combinations need attention` : "\nNo horizontal overflow or console errors");
process.exit(problems ? 1 : 0);
