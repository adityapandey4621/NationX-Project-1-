#!/usr/bin/env node
// Browser check of the customer interactions against a running site with sample data
// (`npm run dev:stack -- --prod`):  node scripts/interactions-check.mjs [baseUrl]
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(path.join(root, "package.json"))("playwright");
const base = process.argv[2] ?? "http://127.0.0.1:3100";
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` (${detail})` : ""}`);
};

const browser = await chromium.launch();

// Desktop ------------------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(base + "/");
  const box = page.getByRole("combobox").first();
  await box.fill("spark");
  const option = page.getByRole("option", { name: /Sample Spark Electricals/ });
  await option.waitFor({ timeout: 8000 }).catch(() => {});
  check("typing in the hero search shows real shop suggestions", (await option.count()) > 0);
  await box.press("ArrowDown");
  await box.press("Enter");
  await page.waitForURL(/\/shop\/sample-spark-electricals/, { timeout: 8000 }).catch(() => {});
  check("keyboard selection opens the storefront", /\/shop\/sample-spark-electricals/.test(page.url()), page.url());
  check("storefront shows items, hours and a sample badge", (await page.getByText("Sample listing").count()) > 0 && (await page.getByText(/Hours:/).count()) > 0);

  await page.goto(base + "/");
  await page.getByRole("button", { name: /All of Khammam/ }).click();
  await page.getByRole("button", { name: "Wyra Road" }).click();
  await page.getByRole("heading", { name: "Stores in Wyra Road" }).waitFor({ timeout: 10000 }).catch(() => {});
  check("choosing an area in the header remembers it", (await page.getByRole("button", { name: /Wyra Road/ }).count()) > 0);
  check("homepage then shows only that area's stores", (await page.getByRole("heading", { name: "Stores in Wyra Road" }).count()) === 1 && (await page.getByText("Sample Care Pharmacy").count()) === 0);
  await page.goto(base + "/search", { waitUntil: "networkidle" });
  const scoped = await page.locator("article").count();
  check("search results default to the remembered area (chip shown)", (await page.getByRole("link", { name: /Wyra Road/ }).count()) > 0 && scoped === 2, `articles=${scoped}`);
  await Promise.all([page.waitForURL(/locality=all/, { waitUntil: "commit" }), page.getByRole("link", { name: /Wyra Road.*remove filter/ }).click()]);
  await page.waitForLoadState("networkidle");
  await page.locator("article").first().waitFor({ timeout: 10000 }).catch(() => {});
  const all = await page.locator("article").count();
  check("removing the area chip shows all areas", all === 8, `articles=${all}`);

  await page.goto(base + "/explore?category=pharmacy&locality=all");
  check("category filter works", (await page.locator("article").count()) === 1 && (await page.getByText("Sample Care Pharmacy").count()) > 0);
  await page.goto(base + "/explore");
  await page.getByLabel("Sort by").selectOption("name");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await page.waitForLoadState("networkidle");
  const names = await page.locator("article h3").allInnerTexts();
  check("sorting by name is applied", names.length > 1 && names.every((n, i) => i === 0 || names[i - 1].toLowerCase() <= n.toLowerCase()), names.join("|"));
  await page.goto(base + "/search?q=zzzzqq");
  await Promise.all([page.waitForURL(/help-me-find-it/, { waitUntil: "commit" }), page.getByRole("link", { name: "Ask us to find it" }).click()]);
  await page.waitForLoadState("networkidle");
  const prefilled = await page.getByLabel(/What are you looking for/i).inputValue();
  check("empty search leads to Help Me Find It prefilled", prefilled === "zzzzqq", `value="${prefilled}" url=${page.url()}`);
  await page.goto(base + "/");
  await page.getByRole("link", { name: "Add your shop" }).first().click();
  await page.waitForLoadState("networkidle");
  check("merchant call-to-action goes to the application flow (sign-in first when signed out)", /merchant\/apply|sign-in/.test(page.url()), page.url());
  await ctx.close();
}

// Mobile -------------------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(base + "/");
  await page.getByRole("button", { name: "Open menu" }).tap();
  check("mobile menu opens with navigation links", (await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Explore stores" }).count()) === 1);
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Explore stores" }).tap();
  await page.waitForURL(/\/explore/);
  check("menu closes after navigating", (await page.getByRole("navigation", { name: "Menu" }).count()) === 0);
  const small = await page.evaluate(() => [...document.querySelectorAll("a,button,select,input")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 36 && !e.closest(".sr-only") && getComputedStyle(e).position !== "absolute"; }).map((e) => (e.textContent || e.getAttribute("name") || e.tagName).trim().slice(0, 24)));
  console.log("   (interactive elements under 36px tall on /explore:", small.length ? small.join(", ") : "none", ")");
  await page.goto(base + "/shop/sample-daily-kirana", { waitUntil: "networkidle" });
  const bar = page.getByRole("navigation", { name: "Contact", exact: true });
  const links = await bar.getByRole("link").allInnerTexts();
  const box = await bar.last().boundingBox();
  check("storefront has a visible mobile action bar with Call / Directions", links.some((l) => /Call/.test(l)) && links.some((l) => /Directions/.test(l)) && !!box && box.y + box.height <= 844 + 1, `links=${links.join("|")} box=${JSON.stringify(box)}`);
  await ctx.close();
}
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nAll interaction checks passed");
process.exit(failed ? 1 : 0);
