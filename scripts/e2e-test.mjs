#!/usr/bin/env node
// Browser end-to-end test against REAL Supabase Auth (GoTrue) + PostgREST + Postgres.
//
//   npm run test:e2e        (needs Docker; downloads the GoTrue image once; needs `npx playwright install chromium`)
//
// Real: Chromium, the production build of the web app, server actions, cookie sessions, GoTrue sign-up/sign-in/
// sign-out and token refresh, the profile trigger firing on a GoTrue-created user, PostgREST, RLS, SQL workflows.
// NOT real: Supabase Storage (uploads), e-mail delivery (GoTrue auto-confirms), the hosted Supabase project, a real
// browser matrix (Chromium only). Run `npm run test:integration` first or let this build `.next-integration` itself.
import { spawn, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SECRET = "integration-test-secret-integration-test-secret";
const NET = "nx-e2e", DB = "nx-e2e-db", REST = "nx-e2e-rest", AUTH = "nx-e2e-auth";
const REST_PORT = 3101, AUTH_PORT = 9998, GATEWAY_PORT = 54399, APP_PORT = 3199;
const APP = `http://127.0.0.1:${APP_PORT}`;
const GATEWAY = `http://127.0.0.1:${GATEWAY_PORT}`;
const DIST = process.env.E2E_DIST || ".next-integration";
const GOTRUE_IMAGE = "supabase/gotrue:v2.172.1";

const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
const jwt = (claims) => { const h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ iat: 1700000000, exp: 4102444800, ...claims }); return `${h}.${p}.${createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const docker = (args, input) => spawnSync("docker", args, { encoding: "utf8", input });
const psql = (sql) => { const r = docker(["exec", "-i", DB, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-tA"], sql); if (r.status !== 0) throw new Error(`psql failed: ${r.stderr}\n${sql.slice(0, 200)}`); return r.stdout.trim(); };
const psqlFile = (f) => { const r = docker(["exec", DB, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", `/work/${f}`]); if (r.status !== 0) throw new Error(`${f} failed:\n${r.stderr}`); };

let passed = 0; const failures = [];
function check(name, ok, detail = "") { if (ok) passed++; else failures.push(`${name}${detail ? ` - ${detail}` : ""}`); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` (${detail})` : ""}`); }

let gateway, appProc;
async function startStack() {
  docker(["rm", "-f", DB, REST, AUTH]); docker(["network", "rm", NET]); docker(["network", "create", NET]);
  if (docker(["run", "-d", "--rm", "--name", DB, "--network", NET, "--tmpfs", "/var/lib/postgresql/data", "-e", "POSTGRES_PASSWORD=pw", "postgres:16-alpine"]).status !== 0) throw new Error("could not start Postgres");
  for (let i = 0; i < 80; i++) { if (docker(["exec", DB, "psql", "-U", "postgres", "-tAc", "select 1"]).stdout?.trim() === "1") break; await sleep(500); }
  docker(["cp", path.join(root, "supabase"), `${DB}:/work`]);
  psqlFile("tests/stub_supabase.sql");
  psql("DROP TABLE auth.users; CREATE ROLE authenticator LOGIN PASSWORD 'pw' NOINHERIT; GRANT anon, authenticated, service_role TO authenticator; CREATE ROLE supabase_auth_admin LOGIN SUPERUSER PASSWORD 'pw';");
  // GoTrue creates auth.users itself (real schema) - the stub's table was only there for the plain-Postgres suites.
  const auth = docker(["run", "-d", "--name", AUTH, "--network", NET, "-p", `127.0.0.1:${AUTH_PORT}:9999`,
    "-e", "GOTRUE_API_HOST=0.0.0.0", "-e", "PORT=9999", "-e", `API_EXTERNAL_URL=${GATEWAY}`,
    "-e", "GOTRUE_DB_DRIVER=postgres", "-e", `GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:pw@${DB}:5432/postgres?search_path=auth`, "-e", "GOTRUE_DB_NAMESPACE=auth",
    "-e", `GOTRUE_SITE_URL=${APP}`, "-e", `GOTRUE_URI_ALLOW_LIST=${APP}/**`, "-e", `GOTRUE_JWT_SECRET=${SECRET}`, "-e", "GOTRUE_JWT_EXP=3600", "-e", "GOTRUE_JWT_AUD=authenticated", "-e", "GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated",
    "-e", "GOTRUE_DISABLE_SIGNUP=false", "-e", "GOTRUE_EXTERNAL_EMAIL_ENABLED=true", "-e", "GOTRUE_MAILER_AUTOCONFIRM=true", "-e", "GOTRUE_RATE_LIMIT_EMAIL_SENT=10000", "-e", "GOTRUE_SMTP_HOST=localhost", "-e", "GOTRUE_SMTP_PORT=2500",
    GOTRUE_IMAGE]);
  if (auth.status !== 0) throw new Error(`could not start GoTrue: ${auth.stderr}`);
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`http://127.0.0.1:${AUTH_PORT}/health`)).ok) break; } catch { /* starting */ } await sleep(500); }
  if (psql("SELECT to_regclass('auth.users') IS NOT NULL") !== "t") throw new Error("GoTrue did not create auth.users: " + docker(["logs", AUTH]).stderr.slice(-800));
  for (const f of readdirSync(path.join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort()) psqlFile(`migrations/${f}`);
  psqlFile("seed.sql");
  // GoTrue's tables belong to its own role; the API roles need to read auth.users only through our functions.
  const rest = docker(["run", "-d", "--rm", "--name", REST, "--network", NET, "-p", `127.0.0.1:${REST_PORT}:3000`,
    "-e", `PGRST_DB_URI=postgres://authenticator:pw@${DB}:5432/postgres`, "-e", "PGRST_DB_SCHEMAS=public", "-e", "PGRST_DB_ANON_ROLE=anon", "-e", `PGRST_JWT_SECRET=${SECRET}`, "-e", "PGRST_DB_POOL=5", "postgrest/postgrest:v12.2.3"]);
  if (rest.status !== 0) throw new Error(`could not start PostgREST: ${rest.stderr}`);
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${REST_PORT}/`)).ok) break; } catch { /* starting */ } await sleep(500); }
}

/** Supabase's edge in miniature: /auth/v1/* -> GoTrue, /rest/v1/* -> PostgREST. */
function startGateway(anonKey) {
  gateway = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const chunks = []; for await (const ch of req) chunks.push(ch);
    const body = ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks);
    const headers = { ...req.headers }; for (const h of ["host", "connection", "content-length"]) delete headers[h];
    let target;
    if (url.pathname.startsWith("/auth/v1/")) target = `http://127.0.0.1:${AUTH_PORT}${url.pathname.slice("/auth/v1".length)}${url.search}`;
    else if (url.pathname.startsWith("/rest/v1/")) {
      target = `http://127.0.0.1:${REST_PORT}${url.pathname.slice("/rest/v1".length)}${url.search}`;
      delete headers.apikey;
      if ((headers.authorization ?? "").replace(/^Bearer\s+/i, "") === anonKey) delete headers.authorization;
    } else { res.writeHead(404).end(); return; }
    const started = Date.now();
    try {
      const up = await fetch(target, { method: req.method, headers, body, signal: AbortSignal.timeout(8000) });
      if (process.env.E2E_DEBUG && Date.now() - started > 3000) console.log(`[gateway] slow ${req.method} ${url.pathname} ${Date.now() - started} ms`);
      const out = Buffer.from(await up.arrayBuffer());
      res.writeHead(up.status, Object.fromEntries([...up.headers].filter(([k]) => !["content-encoding", "transfer-encoding", "content-length", "connection"].includes(k)))).end(out);
    } catch (e) { console.log(`[gateway] upstream failed after ${Date.now() - started} ms: ${req.method} ${url.pathname} ${String(e).slice(0, 80)}`); res.writeHead(504).end(String(e)); }
  });
  gateway.keepAliveTimeout = 65_000; // avoid the client reusing a socket the gateway is just closing
  gateway.headersTimeout = 66_000;
  return new Promise((r) => gateway.listen(GATEWAY_PORT, "127.0.0.1", r));
}

async function ensureBuildAndStart(env) {
  if (process.env.E2E_DEV) {
    // Diagnostics only: a development server prints full (non-minified) hydration diffs.
    appProc = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "dev", "-p", String(APP_PORT)], { cwd: root, env: { ...env, NEXT_DIST_DIR: ".next-e2e-dev" }, stdio: "inherit" });
    for (let i = 0; i < 120; i++) { try { await fetch(`${APP}/api/health`); return; } catch { await sleep(500); } }
    throw new Error("dev app did not start");
  }
  if (!existsSync(path.join(root, DIST, "BUILD_ID"))) {
    console.log("Building the app (production) …");
    const b = spawnSync(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "build"], { cwd: root, env, encoding: "utf8" });
    if (b.status !== 0) throw new Error(`build failed:\n${b.stdout}\n${b.stderr}`);
  }
  appProc = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "start", "-p", String(APP_PORT)], { cwd: root, env: { ...env, NODE_ENV: "production" }, stdio: process.env.E2E_DEBUG ? "inherit" : "ignore" });
  for (let i = 0; i < 80; i++) { try { await fetch(`${APP}/api/health`); return; } catch { await sleep(500); } }
  throw new Error("app did not start");
}

const PASSWORD = "E2e-passw0rd!";
const users = {
  customer: { name: "Customer Chitra", email: "customer@e2e.test", phone: "+919848011001" },
  merchant: { name: "Merchant Murali", email: "merchant@e2e.test", phone: "+919848011002" },
  other: { name: "Other Omkar", email: "other@e2e.test", phone: "+919848011003" },
  admin: { name: "Admin Anita", email: "admin@e2e.test", phone: "+919848011004" },
};

async function scenarios(browser) {
  const consoleProblems = [];
  async function newUserPage(key) {
    const ctx = await browser.newContext({ baseURL: APP });
    const page = await ctx.newPage();
    page.on("console", (m) => { if (/Failed to load resource: the server responded with a status of 404/.test(m.text())) return; /* a deliberate 404 page load */ if (m.type() === "error" || /content security policy/i.test(m.text())) consoleProblems.push(`${key}: ${m.text().slice(0, process.env.E2E_DEV ? 1800 : 160)}`); });
    // E2E_CAPTURE=<dir>: on a page error, save the server HTML and the DOM after React recovered, so a hydration
    // mismatch (React #418) can be diffed instead of guessed at.
    const serverHtml = new Map();
    if (process.env.E2E_CAPTURE) {
      page.on("response", async (res) => {
        try { if (res.request().resourceType() === "document") serverHtml.set(res.url(), await res.text()); } catch { /* redirects have no body */ }
      });
    }
    page.on("pageerror", async (e) => {
      consoleProblems.push(`${key}: pageerror at ${page.url().replace(APP, "")} ${String(e).slice(0, 110)}`);
      if (!process.env.E2E_CAPTURE) return;
      try {
        const { writeFileSync, mkdirSync } = await import("node:fs");
        mkdirSync(process.env.E2E_CAPTURE, { recursive: true });
        await new Promise((r) => setTimeout(r, 2000)); // let the streamed document body finish being read
        const stamp = `${key}-${Date.now()}`;
        writeFileSync(path.join(process.env.E2E_CAPTURE, `${stamp}.server.html`), serverHtml.get(page.url()) ?? "(no server html captured for " + page.url() + ")");
        writeFileSync(path.join(process.env.E2E_CAPTURE, `${stamp}.dom.html`), await page.content());
        writeFileSync(path.join(process.env.E2E_CAPTURE, `${stamp}.txt`), `${page.url()}\n${String(e)}\n`);
      } catch { /* diagnostics only */ }
    });
    if (process.env.E2E_DEBUG) {
      page.on("requestfailed", (rq) => console.log(`[${key}] request failed: ${rq.method()} ${rq.url().slice(0, 100)} ${rq.failure()?.errorText}`));
      page.on("response", (rs) => { if (rs.request().method() === "POST") { const t0 = Date.now(); console.log(`[${key}] POST ${rs.url().slice(0, 90)} -> ${rs.status()} (${rs.headers()["content-type"] ?? ""})`); Promise.race([rs.body().then((b) => `body ${b.length} bytes after ${Date.now() - t0} ms: ${b.toString().slice(0, 160).replace(/\n/g, " ")}`), sleep(25000).then(() => "BODY NEVER FINISHED (25s)")]).then((s) => console.log(`[${key}]   ${rs.url().slice(-40)} ${s}`)).catch(() => undefined); } });
    }
    return { ctx, page };
  }
  async function signUp(page, u) {
    await page.goto("/sign-up");
    await page.getByLabel("Full name").fill(u.name);
    await page.getByLabel("Email").fill(u.email);
    await page.getByLabel("Mobile number").fill(u.phone);
    await page.getByLabel("Password").fill(PASSWORD);
    try {
      await Promise.all([page.waitForURL(/\/account/, { timeout: 20000 }), page.getByRole("button", { name: /create account|sign up/i }).click()]);
    } catch (e) {
      console.log("sign-up did not reach /account. Page says:", (await page.locator("body").innerText()).slice(0, 600));
      console.log("GoTrue log tail:\n" + (docker(["logs", "--tail", "12", AUTH]).stderr || docker(["logs", "--tail", "12", AUTH]).stdout).slice(-1800));
      throw e;
    }
  }

  // A denied page must be a real HTTP 404 (there are no loading boundaries above these routes any more - they used to
  // stream a 200 first) AND must return no data.
  async function denied(page, url, secretPattern) {
    const resp = await page.goto(url);
    const text = await page.locator("body").innerText();
    return { status: resp.status(), ok: resp.status() === 404 && !secretPattern.test(text) };
  }

  console.log("\n— Real sign-up, profile trigger, sessions —");
  const cust = await newUserPage("customer");
  await signUp(cust.page, users.customer);
  check("sign-up with real Supabase Auth lands on the account page, signed in", /\/account/.test(cust.page.url()) && (await cust.page.getByText(users.customer.email).count()) > 0);
  const prof = psql(`SELECT p.full_name || '|' || p.phone || '|' || (SELECT string_agg(role, ',') FROM user_roles WHERE user_id = p.id) FROM profiles p WHERE p.email = '${users.customer.email}'`);
  check("GoTrue's user created the profile + customer role through our trigger (real auth.users)", prof === `${users.customer.name}|${users.customer.phone}|customer`, prof);
  const d1 = await denied(cust.page, "/admin", /Administration|Review queue|Merchant applications/);
  check("a signed-in customer is shown Not Found on /admin and receives no admin data", d1.ok, `status ${d1.status}`);
  const protectedMerchant = await cust.page.goto("/merchant");
  check("a signed-in customer may open /merchant (the apply area)", protectedMerchant.status() === 200);

  console.log("\n— Merchant applies; sign-out, protected routes, sign-in —");
  const mer = await newUserPage("merchant");
  await signUp(mer.page, users.merchant);
  await mer.page.goto("/merchant/apply");
  await mer.page.getByLabel("Shop / business name").fill("E2E Sri Ram Kirana");
  await mer.page.locator("#category_id").selectOption({ label: "Kirana" });
  await mer.page.locator("#locality_id").selectOption({ label: "Gandhi Chowk" });
  await mer.page.getByLabel("Shop phone").fill("+919848099111");
  await mer.page.getByLabel("Address", { exact: true }).fill("Near Old Bus Stand, Khammam");
  await mer.page.locator("#business_description").fill("Daily groceries, grains and oils");
  await mer.page.locator('input[name="operating_models"][value="visit_only"]').check();
  await mer.page.locator('input[name="declaration_accepted"]').check();
  await mer.page.getByRole("button", { name: /submit/i }).first().click();
  await mer.page.waitForURL(/\/merchant\/applications\//, { timeout: 20000 }).catch(() => undefined);
  const appRow = psql(`SELECT status || '|' || business_name FROM merchant_applications WHERE business_name = 'E2E Sri Ram Kirana'`);
  check("the application form (server action) saved a SUBMITTED application", appRow === "submitted|E2E Sri Ram Kirana", appRow);
  const preSlug = await (await newUserPage("anon")).page.goto("/shop/e2e-sri-ram-kirana-gandhi-chowk");
  check("the pending shop has no public page (404)", preSlug.status() === 404);

  await mer.page.getByRole("button", { name: "Sign out" }).click();
  // Wait for the server action to finish (the signed-in header disappears) before navigating away; navigating
  // immediately cancels the in-flight sign-out and leaves the session alive (a race in this script, not in the app).
  await mer.page.getByRole("button", { name: "Sign out" }).waitFor({ state: "detached", timeout: 20000 });
  await mer.page.waitForLoadState("networkidle");
  const afterOut = await mer.page.goto("/merchant");
  check("after sign-out the protected area redirects to sign-in", /\/sign-in/.test(mer.page.url()), mer.page.url());
  await mer.page.getByLabel("Email").fill(users.merchant.email);
  await mer.page.getByLabel("Password").fill("wrong-password");
  await mer.page.getByRole("button", { name: /sign in/i }).click();
  await mer.page.waitForTimeout(1500);
  check("a wrong password is refused with a uniform message and stays on sign-in", /\/sign-in/.test(mer.page.url()) && (await mer.page.getByText(/invalid|incorrect/i).count()) > 0);
  // (a failed attempt resets the uncontrolled form, so both fields are retyped)
  await mer.page.getByLabel("Email").fill(users.merchant.email);
  await mer.page.getByLabel("Password").fill(PASSWORD);
  await mer.page.getByRole("button", { name: /sign in/i }).click();
  await mer.page.waitForURL((u) => !/\/sign-in/.test(u.toString()), { timeout: 15000 }).catch(async () => console.log("still on sign-in; page says:", (await mer.page.locator("main").innerText()).slice(0, 400)));
  check("signing in again with the right password works and returns to the requested page", /\/merchant/.test(mer.page.url()), mer.page.url());
  void afterOut;

  console.log("\n— Admin approves (real session, real role) —");
  const adm = await newUserPage("admin");
  await signUp(adm.page, users.admin);
  const d2 = await denied(adm.page, "/admin/applications", /E2E Sri Ram Kirana|Review queue/);
  check("a normal account cannot reach the admin queue before it is made admin", d2.ok, `status ${d2.status}`);
  psql(`SET ROLE service_role; SELECT bootstrap_first_admin('${users.admin.email}');`);
  await adm.page.goto("/admin/applications");
  check("after the one-time bootstrap the admin sees the review queue", /E2E Sri Ram Kirana/.test(await adm.page.content()));
  await adm.page.getByRole("link", { name: /E2E Sri Ram Kirana/ }).first().click();
  await adm.page.getByRole("button", { name: /Approve & publish storefront/ }).click();
  // After approval the decision panel is replaced by an "Open storefront" link (the page re-renders).
  await adm.page.getByRole("link", { name: /Open storefront/ }).waitFor({ timeout: 30000 });
  const slug = psql(`SELECT slug FROM storefronts sf JOIN shops s ON s.id = sf.shop_id WHERE s.name = 'E2E Sri Ram Kirana'`);
  check("approval published a storefront with the deterministic slug", slug === "e2e-sri-ram-kirana-gandhi-chowk", slug);
  check("exactly one business / owner / merchant role were created", psql(`SELECT (SELECT count(*) FROM businesses WHERE name='E2E Sri Ram Kirana') || '|' || (SELECT count(*) FROM business_members bm JOIN businesses b ON b.id=bm.business_id WHERE b.name='E2E Sri Ram Kirana' AND bm.role='owner') || '|' || (SELECT count(*) FROM user_roles ur JOIN profiles p ON p.id=ur.user_id WHERE p.email='${users.merchant.email}' AND ur.role='merchant')`) === "1|1|1");

  console.log("\n— Customer discovery in a real browser —");
  const anon = await newUserPage("anon2");
  const shopPage = await anon.page.goto(`/shop/${slug}`);
  check("the public storefront renders for an anonymous visitor", shopPage.status() === 200 && (await anon.page.getByRole("heading", { name: "E2E Sri Ram Kirana" }).count()) === 1);
  await anon.page.goto("/");
  await anon.page.locator('input[name="q"]:visible').first().fill("kirana");
  await anon.page.keyboard.press("Enter");
  await anon.page.waitForURL(/\/search/);
  check("searching from the home page finds the shop", (await anon.page.getByText("E2E Sri Ram Kirana").count()) > 0);
  await anon.page.getByText("E2E Sri Ram Kirana").first().click();
  await anon.page.waitForURL(/\/shop\//);
  check("opening the result shows the storefront with a way back to the results", (await anon.page.getByText("Back to results").count()) > 0);

  console.log("\n— Merchant workspace: edit shop, add an item —");
  await mer.page.goto("/merchant");
  const shopId = psql(`SELECT id FROM shops WHERE name = 'E2E Sri Ram Kirana'`);
  await mer.page.goto(`/merchant/shops/${shopId}`);
  await mer.page.getByLabel("Headline").fill("Fresh stock every morning");
  await mer.page.getByRole("button", { name: /save changes/i }).first().click();
  await mer.page.getByText(/Changes saved/).waitFor({ timeout: 20000 });
  await anon.page.goto(`/shop/${slug}`);
  check("a merchant edit appears on the public page immediately", (await anon.page.getByText("Fresh stock every morning").count()) > 0);
  // The real browser sent a view beacon when it opened the storefront; the merchant sees it as a count.
  await anon.page.waitForTimeout(1500);
  await anon.page.getByRole("link", { name: /^Call$/ }).first().evaluate((el) => el.addEventListener("click", (e) => e.preventDefault(), { once: true }));
  await anon.page.getByRole("link", { name: /^Call$/ }).first().click();
  await anon.page.waitForTimeout(1500);
  await mer.page.goto(`/merchant/shops/${shopId}`);
  check("the merchant sees real page-view and call-tap counts from that visit",
    Number(psql(`SELECT COALESCE(sum(views),0) FROM storefront_stats_daily WHERE shop_id = '${shopId}'`)) >= 1
      && Number(psql(`SELECT COALESCE(sum(calls),0) FROM storefront_stats_daily WHERE shop_id = '${shopId}'`)) >= 1
      && (await mer.page.getByText("Your page, last 30 days").count()) > 0
      && (await mer.page.getByText("Calls tapped").count()) > 0);  console.log("\n— Language switch and waitlist in a real browser —");
  await anon.page.goto("/");
  await anon.page.getByRole("button", { name: "తెలుగు" }).first().click();
  await anon.page.getByText("మీ పరిసరాల దుకాణాలన్నీ ఒకే చోట").first().waitFor({ timeout: 20000 });
  check("choosing Telugu switches the page, sets lang=te and remembers it on the next page",
    (await anon.page.locator("html").getAttribute("lang")) === "te" && (await anon.page.getByText("సైన్ ఇన్").count()) > 0);
  await anon.page.goto("/explore");
  check("the Telugu choice is remembered across pages", (await anon.page.locator("html").getAttribute("lang")) === "te");
  await anon.page.goto("/waitlist?locality=wyra-road");
  check("the waitlist form is in Telugu and preselects the area from the link", (await anon.page.getByText("నా దగ్గర దుకాణాలు తెరిచినప్పుడు చెప్పండి").count()) > 0 && (await anon.page.locator("#locality_id").inputValue()) !== "");
  await anon.page.getByRole("button", { name: "English" }).first().click();
  await anon.page.getByText("Tell me when shops open near me").first().waitFor({ timeout: 20000 });
  check("switching back to English returns to the same page in English", /\/waitlist/.test(anon.page.url()) && (await anon.page.locator("html").getAttribute("lang")) === "en");
  await anon.page.getByLabel("Mobile number").first().fill("98480 77001");
  const areaBefore = await anon.page.locator("#locality_id").inputValue();
  await anon.page.getByRole("button", { name: /notify me/i }).click();
  await anon.page.getByText("Please agree to be contacted when shops open in this area").waitFor({ timeout: 20000 });
  check("submitting without consent is refused with a clear message and saves nothing", psql(`SELECT count(*) FROM area_waitlist WHERE contact_phone = '+919848077001'`) === "0");
  check("a failed submit keeps what the person typed and the area they chose (no silent change of area)",
    (await anon.page.locator("#locality_id").inputValue()) === areaBefore && areaBefore !== "" && (await anon.page.locator("#contact_phone").inputValue()) === "98480 77001");
  await anon.page.locator('input[name="consent_given"]').check();
  await anon.page.getByRole("button", { name: /notify me/i }).click();
  await anon.page.getByText("You are on the list").waitFor({ timeout: 20000 });
  check("a visitor consents and joins the waitlist through the real form (server action)",
    psql(`SELECT count(*) FROM area_waitlist WHERE contact_phone = '+919848077001' AND consent_given`) === "1");
  await anon.page.locator("#leave_locality").selectOption({ label: "Wyra Road" });
  await anon.page.locator("form").last().getByLabel("Mobile number").fill("98480 77001");
  await anon.page.getByRole("button", { name: "Remove", exact: true }).click();
  await anon.page.getByText(/has been removed/).waitFor({ timeout: 20000 });
  check("withdrawing through the form deletes the entry and the phone number", psql(`SELECT count(*) FROM area_waitlist WHERE contact_phone = '+919848077001'`) === "0");
  await mer.page.goto(`/merchant/shops/${shopId}/products`);
  await mer.page.getByLabel("Item name").fill("Basmati Rice");
  await mer.page.getByLabel(/Price/).first().fill("120");
  await mer.page.getByLabel("Availability").selectOption("in_stock");
  await mer.page.getByRole("button", { name: "Add item" }).click();
  await mer.page.getByText("Item added.").waitFor({ timeout: 20000 });
  await anon.page.goto(`/shop/${slug}`);
  check("the new item shows on the storefront with its price and a fresh 'In stock' label", /Basmati Rice/.test(await anon.page.content()) && /₹120\.00/.test(await anon.page.content()) && (await anon.page.getByText("In stock").count()) > 0);
  await anon.page.goto("/search?q=basmati");
  check("the item is searchable and credited to the shop", (await anon.page.getByText("Items for").count()) > 0 && (await anon.page.getByText("Basmati Rice").count()) > 0);

  console.log("\n— Data isolation in the browser —");
  const oth = await newUserPage("other");
  await signUp(oth.page, users.other);
  const leak = /E2E Sri Ram Kirana|Fresh stock|Basmati/;
  const d3 = await denied(oth.page, `/merchant/shops/${shopId}`, leak);
  check("another signed-in merchant is shown Not Found for this shop's workspace and sees none of its data", d3.ok, `status ${d3.status}`);
  const d4 = await denied(oth.page, `/merchant/shops/${shopId}/products`, leak);
  check("...and for its items page", d4.ok, `status ${d4.status}`);
  const d5 = await denied(oth.page, "/admin/storefronts", /E2E Sri Ram Kirana|Hide, suspend/);
  check("...and for the admin pages", d5.ok, `status ${d5.status}`);

  console.log("\n— Help Me Find It through the form —");
  await cust.page.goto("/help-me-find-it");
  await cust.page.getByLabel("What are you looking for?").fill("Wood-pressed sesame oil 5L");
  await cust.page.locator("#locality_id").selectOption({ label: "Gandhi Chowk" });
  await cust.page.locator('input[name="consent_given"]').check();
  await cust.page.getByRole("button", { name: "Send request" }).click();
  await cust.page.getByText(/HMF-KHM-\d{6}-\d{4}/).first().waitFor({ timeout: 20000 });
  const tid = (await cust.page.getByText(/HMF-KHM-\d{6}-\d{4}/).first().innerText()).match(/HMF-KHM-\d{6}-\d{4}/)[0];
  check("the customer receives a server-generated tracking ID", /^HMF-KHM-\d{6}-\d{4}$/.test(tid), tid);
  await cust.page.goto("/account/requests");
  check("it appears under the customer's own requests", (await cust.page.getByText(tid).count()) > 0);
  await oth.page.goto("/account/requests");
  check("another customer does not see it", (await oth.page.getByText(tid).count()) === 0);

  console.log("\n— Moderation visible to the public —");
  await adm.page.goto("/admin/storefronts");
  await adm.page.getByLabel(/Reason/).first().fill("Complaint under review");
  await adm.page.getByRole("button", { name: "Suspend" }).first().click();
  await adm.page.getByText("Storefront is now suspended.").waitFor({ timeout: 20000 });
  check("a suspended storefront is a 404 for visitors", (await anon.page.goto(`/shop/${slug}`)).status() === 404);
  check("...and gone from search", (await (async () => { await anon.page.goto("/search?q=kirana"); return anon.page.getByText("E2E Sri Ram Kirana").count(); })()) === 0);
  await mer.page.goto(`/merchant/shops/${shopId}`);
  check("the owner sees the suspension and the reason in their workspace", (await mer.page.getByText(/Complaint under review/).count()) > 0);

  check("no browser console errors or Content-Security-Policy violations on any page visited", consoleProblems.length === 0, consoleProblems.slice(0, 4).join(" | "));
}

let code = 1, browser;
try {
  const anonKey = jwt({ role: "anon" });
  const env = { ...process.env, NEXT_DIST_DIR: DIST, NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_SUPABASE_URL: GATEWAY, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey, NEXT_PUBLIC_APP_URL: APP,
    API_RATE_LIMIT_READ: "1000000", API_RATE_LIMIT_WRITE: "1000000", API_RATE_LIMIT_SENSITIVE: "1000000" };
  delete env.NODE_ENV;
  console.log("Starting Postgres + GoTrue + PostgREST …");
  await startStack(); await startGateway(anonKey); await ensureBuildAndStart(env);
  browser = await chromium.launch({ args: ["--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows"] });
  await scenarios(browser);
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) console.log("Failures:\n- " + failures.join("\n- "));
  code = failures.length ? 1 : 0;
} catch (e) {
  console.error("\nE2E aborted:", e?.stack ?? e);
} finally {
  await browser?.close();
  appProc?.kill();
  await new Promise((r) => (gateway ? gateway.close(r) : r()));
  docker(["rm", "-f", DB, REST, AUTH]); docker(["network", "rm", NET]);
}
process.exit(code);