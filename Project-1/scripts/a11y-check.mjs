#!/usr/bin/env node
// Automated accessibility audit (axe-core, WCAG 2.0/2.1 A + AA incl. colour contrast) of the public pages
// at phone and desktop widths, against a running site with sample data:
//   npm run dev:stack -- --prod      (in one terminal)
//   node scripts/a11y-check.mjs [baseUrl]
// Exit code 1 if any "serious" or "critical" violation is found. Automated checks catch roughly a third of real
// accessibility problems: this does NOT replace a screen-reader pass or a manual keyboard review.
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const { chromium } = require("playwright");
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const base = process.argv[2] ?? "http://127.0.0.1:3100";

const PAGES = [
  "/", "/explore", "/search?q=spark", "/category/kirana", "/shop/sample-spark-electricals",
  "/sign-in", "/sign-up", "/help-me-find-it", "/sell", "/about", "/contact", "/privacy", "/terms", "/app",
];
const VIEWPORTS = [{ name: "phone 390px", width: 390, height: 844 }, { name: "desktop 1440px", width: 1440, height: 900 }];

const browser = await chromium.launch();
let blocking = 0;
let moderate = 0;
const seen = new Map();
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  for (const url of PAGES) {
    const res = await page.goto(base + url, { waitUntil: "networkidle" }).catch(() => null);
    if (!res || res.status() >= 400) {
      console.log(`SKIP  ${vp.name}  ${url}  (HTTP ${res?.status() ?? "no response"})`);
      continue;
    }
    await page.evaluate(axeSource);
    const result = await page.evaluate(() =>
      axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } }),
    );
    const bad = result.violations;
    console.log(`${bad.length === 0 ? "PASS" : "FAIL"}  ${vp.name}  ${url}  (${result.passes.length} rules passed${bad.length ? `, ${bad.length} violated` : ""})`);
    for (const v of bad) {
      const key = `${v.id}|${v.nodes[0]?.target?.join(" ")}`;
      const first = !seen.has(key);
      seen.set(key, true);
      if (v.impact === "serious" || v.impact === "critical") blocking++;
      else moderate++;
      if (first) console.log(`      [${v.impact}] ${v.id}: ${v.help}  (${v.nodes.length} element${v.nodes.length === 1 ? "" : "s"}) e.g. ${v.nodes[0]?.target?.join(" ")}\n        ${v.nodes[0]?.failureSummary?.split("\n").slice(0, 3).join(" | ")}`);
    }
  }
  await ctx.close();
}
await browser.close();
console.log(`\n${blocking} serious/critical and ${moderate} minor/moderate violation(s) across ${PAGES.length} pages x ${VIEWPORTS.length} sizes.`);
process.exit(blocking > 0 ? 1 : 0);
