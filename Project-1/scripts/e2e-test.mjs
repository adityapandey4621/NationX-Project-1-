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
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
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
    // A real person cannot click faster than the page hydrates on a normal device, but a test on a busy machine can.
    // Wait for the network to settle after each navigation so interaction never races hydration. E2E_NO_SETTLE=1
    // restores the old eager behaviour (used to compare error rates).
    if (!process.env.E2E_NO_SETTLE) {
      const rawGoto = page.goto.bind(page);
      page.goto = async (url, options) => {
        const res = await rawGoto(url, options);
        await page.waitForLoadState("networkidle").catch(() => undefined);
        return res;
      };
    }
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
      // Take the URL and the DOM at the instant of the error: waiting first meant the browser had often navigated on,
      // so earlier captures described the wrong page.
      // Everything is written immediately and synchronously: the script can finish (and exit) within a second of the
      // error, so any delay before writing lost the evidence.
      const failedUrl = page.url();
      const stamp = `${key}-${Date.now()}`;
      try {
        mkdirSync(process.env.E2E_CAPTURE, { recursive: true });
        writeFileSync(path.join(process.env.E2E_CAPTURE, `${stamp}.txt`), `${failedUrl}\n${String(e)}\n`);
        writeFileSync(path.join(process.env.E2E_CAPTURE, `${stamp}.server.html`), serverHtml.get(failedUrl) ?? "(no server html captured for " + failedUrl + ")");
      } catch { /* diagnostics only */ }
      try { writeFileSync(path.join(process.env.E2E_CAPTURE, `${stamp}.dom.html`), await page.content()); } catch { /* page may be navigating or closed */ }
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
  // Category-adaptive form (REQ-APP-02): a service category is offered appointment/quote, never pickup/delivery.
  await mer.page.locator("#category_id").selectOption({ label: "Salons" });
  check("choosing a service category offers appointment and quotation and hides pickup and delivery",
    (await mer.page.locator('input[name="operating_models"][value="appointment"]').count()) === 1 && (await mer.page.locator('input[name="operating_models"][value="delivery"]').count()) === 0 && (await mer.page.locator('input[name="operating_models"][value="pickup"]').count()) === 0
      && (await mer.page.getByText("What services do you offer?").count()) > 0);
  await mer.page.locator("#category_id").selectOption({ label: "Kirana" });
  check("choosing a shop category offers pickup and delivery and hides appointment",
    (await mer.page.locator('input[name="operating_models"][value="delivery"]').count()) === 1 && (await mer.page.locator('input[name="operating_models"][value="appointment"]').count()) === 0
      && (await mer.page.getByText("What do you sell?").count()) > 0);
  // PIN code from the device position (the throwaway database has no India Post directory, so seed one post office).
  psql(`INSERT INTO pincodes (pincode, office_name, district, state, latitude, longitude) VALUES ('507001', 'E2E Khammam HO', 'Khammam', 'Telangana', 17.2473, 80.1514)`);
  await mer.ctx.grantPermissions(["geolocation"]);
  // Far case first, near case last: the shared position is also kept as the shop's map position.
  await mer.ctx.setGeolocation({ latitude: 28.6139, longitude: 77.2090 });
  await mer.page.getByRole("button", { name: "Use my location" }).click();
  await mer.page.getByText(/km away, so we did not fill the PIN code/).waitFor({ timeout: 15000 }).catch(() => undefined);
  check("a position far from any known post office does not guess a PIN code", (await mer.page.locator('input[name="pincode"]').inputValue()) === "" && (await mer.page.getByText(/km away, so we did not fill the PIN code/).count()) === 1);
  await mer.ctx.setGeolocation({ latitude: 17.2480, longitude: 80.1520 });
  await mer.page.getByRole("button", { name: "Use my location" }).click();
  // The PIN appears first; the locality is chosen when the lookup answers, which is when the note appears.
  await mer.page.getByRole("status").filter({ hasText: "PIN 507001" }).waitFor({ timeout: 15000 }).catch(() => undefined);
  check("sharing a position near a post office fills the PIN code and picks the matching locality",
    (await mer.page.locator('input[name="pincode"]').inputValue()) === "507001" && (await mer.page.locator("#locality_id").inputValue()) !== "", await mer.page.locator('input[name="pincode"]').inputValue());
  check("the PIN note names the place and asks the applicant to check it", /Khammam HO, Khammam/.test(await mer.page.getByRole("status").filter({ hasText: "PIN 507001" }).innerText().catch(() => "")));
  psql(`DELETE FROM pincodes WHERE office_name = 'E2E Khammam HO'`);
  await mer.page.locator('input[name="pincode"]').fill("");
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
  check("...and the e-mail the person typed is kept (the form is not wiped)", (await mer.page.getByLabel("Email").inputValue()) === users.merchant.email);
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

  console.log("\n— Admin content: taxonomy and homepage curation (no redeploy) —");
  await adm.page.goto("/admin/taxonomy");
  await adm.page.locator("#name").fill("E2E Tailors");
  await adm.page.locator("#default_template").selectOption("service_provider");
  await adm.page.getByRole("button", { name: "Add category" }).click();
  await adm.page.getByText("Saved.").waitFor({ timeout: 20000 });
  check("an admin adds a category from the browser with no code change (template stored)",
    psql(`SELECT slug || '|' || default_template || '|' || is_active FROM categories WHERE name = 'E2E Tailors'`) === "e2e-tailors|service_provider|true");
  check("the new category is immediately a real public page", (await (await newUserPage("anon3")).page.goto("/category/e2e-tailors")).status() === 200);
  await adm.page.locator("li", { hasText: "E2E Tailors" }).getByRole("button", { name: "Turn off" }).click();
  // The "Saved." banner from the previous action is still on screen, so wait for the database itself.
  for (let i = 0; i < 40 && psql(`SELECT is_active FROM categories WHERE name = 'E2E Tailors'`) !== "f"; i++) await new Promise((r) => setTimeout(r, 250));
  const offActive = psql(`SELECT is_active FROM categories WHERE name = 'E2E Tailors'`);
  const offStatus = (await (await newUserPage("anon4")).page.goto("/category/e2e-tailors")).status();
  check("turning a category off hides it from the public (404) and keeps the row", offActive === "f" && offStatus === 404, `is_active=${offActive} status=${offStatus}`);
  await adm.page.goto("/admin/homepage");
  await adm.page.locator("#title").fill("E2E Welcome banner");
  await adm.page.locator("#link_url").fill("/explore");
  await adm.page.getByRole("button", { name: "Add banner" }).click();
  await adm.page.getByText("Saved.").waitFor({ timeout: 20000 });
  await adm.page.locator("#storefront_id").selectOption({ label: "E2E Sri Ram Kirana · Gandhi Chowk" });
  await adm.page.getByRole("button", { name: "Feature this shop" }).click();
  await adm.page.getByText("Saved.").waitFor({ timeout: 20000 });
  const pub = await newUserPage("anon5");
  await pub.page.goto("/");
  check("the homepage shows the admin's banner and featured shop straight away",
    (await pub.page.getByText("E2E Welcome banner").count()) > 0 && (await pub.page.getByRole("heading", { name: "Featured stores" }).count()) > 0);
  psql(`UPDATE storefronts SET visibility_status = 'hidden', visibility_reason = 'e2e' WHERE slug = '${slug}'`);
  await pub.page.goto("/");
  check("hiding a shop removes it from Featured automatically", (await pub.page.getByRole("heading", { name: "Featured stores" }).count()) === 0);
  psql(`UPDATE storefronts SET visibility_status = 'visible', visibility_reason = NULL WHERE slug = '${slug}'`);
  await adm.page.goto("/admin/homepage");
  await adm.page.locator("li", { hasText: "E2E Welcome banner" }).getByRole("button", { name: "Hide", exact: true }).click();
  await adm.page.getByText("Saved.").waitFor({ timeout: 20000 });
  await pub.page.goto("/");
  check("hiding the banner removes it from the homepage", (await pub.page.getByText("E2E Welcome banner").count()) === 0);
  check("...and only that banner: the Announcements section itself is still switched on", psql(`SELECT is_visible FROM homepage_sections WHERE section_key = 'banners'`) === "t");
  check("a customer cannot open the homepage or taxonomy admin pages", (await denied(cust.page, "/admin/homepage", /Banners|Featured/)).ok && (await denied(cust.page, "/admin/taxonomy", /Categories and areas/)).ok);
  console.log("\n— Admin dashboard, store list and team access —");
  await adm.page.goto("/admin");
  const gandhi = adm.page.locator("tr", { hasText: "Gandhi Chowk" }).first();
  check("the admin home lists every area with its live stores (Gandhi Chowk has the approved shop)",
    (await adm.page.getByRole("heading", { name: "Stores by area" }).count()) === 1 && (await gandhi.locator("td").nth(0).innerText()).trim() === "1");
  check("an area with no shops yet is still listed, marked as such", (await adm.page.locator("tr", { hasText: "Wyra Road" }).first().innerText()).includes("no stores yet"));
  check("the platform totals show the live store and the admin themself",
    /1\s+Stores live/.test((await adm.page.getByRole("link", { name: /Stores live/ }).innerText()).replace(/\n/g, " ")) && (await adm.page.getByRole("link", { name: /Administrators/ }).innerText()).includes("1"));
  check("customers cannot open the dashboard or the team page", (await denied(cust.page, "/admin", /Stores by area/)).ok && (await denied(cust.page, "/admin/team", /Give someone access/)).ok);

  await adm.page.goto("/admin/storefronts");
  await adm.page.locator("#locality").selectOption({ label: "Wyra Road" });
  await adm.page.getByRole("button", { name: "Filter" }).click();
  await adm.page.waitForURL(/locality=/);
  check("filtering the store list to an empty area shows nothing", (await adm.page.getByText("Nothing matches these filters.").count()) === 1);
  await adm.page.locator("#locality").selectOption({ label: "Gandhi Chowk" });
  await adm.page.getByRole("button", { name: "Filter" }).click();
  await adm.page.waitForURL(/locality=/);
  check("filtering to the shop's area shows it, with its status", (await adm.page.getByText("E2E Sri Ram Kirana").count()) > 0 && (await adm.page.getByText("Live", { exact: true }).count()) > 0);

  await adm.page.goto("/admin/team");
  check("the team page lists the administrator and offers no way to remove oneself",
    (await adm.page.getByText("Admin Anita").count()) > 0 && (await adm.page.getByRole("button", { name: /Remove Administrator access from Admin Anita/ }).count()) === 0);
  await adm.page.locator("#email").fill("nobody-here@e2e.test");
  await adm.page.getByRole("button", { name: "Give access" }).click();
  await adm.page.getByText(/ask the person to sign up first/).waitFor({ timeout: 20000 });
  check("an unknown e-mail is refused with a clear sentence and nothing is granted", psql(`SELECT count(*) FROM user_roles WHERE role = 'operator'`) === "0");
  await adm.page.locator("#email").fill(users.customer.email.toUpperCase());
  await adm.page.locator("#reason").fill("covering the help desk");
  await adm.page.getByRole("button", { name: "Give access" }).click();
  await adm.page.getByText("Access granted.").waitFor({ timeout: 20000 });
  check("granting Operator by e-mail works, is audited with the note, and shows on the page",
    psql(`SELECT count(*) FROM user_roles ur JOIN profiles p ON p.id = ur.user_id WHERE p.email = '${users.customer.email}' AND ur.role = 'operator'`) === "1"
      && psql(`SELECT count(*) FROM audit_logs WHERE action = 'role.granted' AND reason = 'covering the help desk'`) === "1"
      && (await adm.page.getByText("Customer Chitra").count()) > 0);
  await adm.page.getByRole("button", { name: /Remove Operator access from Customer Chitra/ }).click();
  await adm.page.getByText("Access removed.").waitFor({ timeout: 20000 });
  check("removing the role works and is audited; the customer account itself is untouched",
    psql(`SELECT count(*) FROM user_roles ur JOIN profiles p ON p.id = ur.user_id WHERE p.email = '${users.customer.email}' AND ur.role = 'operator'`) === "0"
      && psql(`SELECT count(*) FROM audit_logs WHERE action = 'role.revoked'`) === "1"
      && psql(`SELECT count(*) FROM user_roles ur JOIN profiles p ON p.id = ur.user_id WHERE p.email = '${users.customer.email}' AND ur.role = 'customer'`) === "1");
  console.log("\n— Search words and modules (administrator) —");
  check("customers cannot open the search-words or modules pages", (await denied(cust.page, "/admin/search", /Link two words/)).ok && (await denied(cust.page, "/admin/modules", /Where it is on/)).ok);
  await adm.page.goto("/admin/search");
  await adm.page.locator("#term").fill("sri ram");
  await adm.page.locator("#alias").fill("zxsriramalias");
  await adm.page.getByRole("button", { name: "Save link" }).click();
  await adm.page.getByText(/2 links added/).waitFor({ timeout: 20000 });
  const aliasAnon = await newUserPage("anon-alias");
  await aliasAnon.page.goto("/search?q=zxsriramalias");
  check("a new alias takes effect at once: the alternative word finds the existing shop, and the change is audited",
    (await aliasAnon.page.getByText("E2E Sri Ram Kirana").count()) > 0 && psql(`SELECT count(*) FROM audit_logs WHERE action = 'search_alias.added'`) === "1");
  await adm.page.goto("/admin/search");
  await adm.page.getByRole("button", { name: "Remove link sri ram to zxsriramalias" }).click();
  await adm.page.getByText("Removed.").waitFor({ timeout: 20000 });
  await aliasAnon.page.goto("/search?q=zxsriramalias");
  check("removing the alias stops it matching and is audited",
    (await aliasAnon.page.getByText("E2E Sri Ram Kirana").count()) === 0 && psql(`SELECT count(*) FROM audit_logs WHERE action = 'search_alias.removed'`) === "1");
  await adm.page.goto("/admin/modules");
  const groc = adm.page.locator("li", { hasText: "Grocery ordering module" }).first();
  check("modules ship switched off", (await groc.getByText("Off", { exact: true }).count()) === 1 && psql(`SELECT count(*) FROM feature_flags WHERE is_enabled`) === "0");
  await groc.getByLabel("Gandhi Chowk").check();
  await groc.getByRole("button", { name: "Turn on" }).click();
  await adm.page.getByText("Saved.").waitFor({ timeout: 20000 });
  check("turning a module on for one area works, shows on the page, and is audited",
    psql(`SELECT is_enabled AND cardinality(enabled_localities) = 1 FROM feature_flags WHERE key = 'grocery'`) === "t"
      && (await adm.page.getByText("On in 1 area").count()) === 1
      && psql(`SELECT count(*) FROM audit_logs WHERE action = 'feature_flag.changed'`) === "1");
  const grocAgain = adm.page.locator("li", { hasText: "Grocery ordering module" }).first();
  await grocAgain.getByRole("button", { name: "Turn off" }).click();
  // "Saved." is already on screen from the previous action, so wait for the change itself: the badge flips to "Off".
  await grocAgain.getByText("Off", { exact: true }).waitFor({ timeout: 20000 });
  check("turning it off again works", psql(`SELECT is_enabled FROM feature_flags WHERE key = 'grocery'`) === "f");
  await aliasAnon.ctx?.close?.();
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

  console.log("\n— Subcategories and category questions: define, apply, approve, show (admin + applicant + public) —");
  const kiranaId = psql(`SELECT id FROM categories WHERE slug = 'kirana'`);
  await adm.page.goto("/admin/taxonomy");
  await adm.page.locator(`li:has(#new-sn-${kiranaId}) summary`, { hasText: "Subcategories" }).click();
  await adm.page.locator(`#new-sn-${kiranaId}`).fill("E2E Staples");
  await adm.page.locator(`form:has(#new-sn-${kiranaId})`).getByRole("button", { name: "Add subcategory" }).click();
  await adm.page.getByText("Saved.").waitFor({ timeout: 20000 });
  check("an admin adds a subcategory from the browser; its web address is derived and it is audited",
    psql(`SELECT slug || '|' || is_active FROM subcategories WHERE name = 'E2E Staples'`) === "kirana-e2e-staples|true" && psql(`SELECT count(*) FROM audit_logs WHERE action = 'subcategory.created'`) === "1");
  await adm.page.goto("/admin/taxonomy");
  await adm.page.locator(`li:has(#nq-l-${kiranaId}) summary`, { hasText: "Questions for applicants" }).click();
  await adm.page.locator(`#nq-l-${kiranaId}`).fill("E2E Shop size");
  await adm.page.locator(`#nq-t-${kiranaId}`).selectOption("choice");
  await adm.page.locator(`#nq-o-${kiranaId}`).fill("Small\nLarge");
  await adm.page.locator(`form:has(#nq-l-${kiranaId}) input[name="is_required"]`).check();
  await adm.page.locator(`form:has(#nq-l-${kiranaId})`).getByRole("button", { name: "Add question" }).click();
  await adm.page.getByText("Saved.").waitFor({ timeout: 20000 });
  await adm.page.goto("/admin/taxonomy");
  await adm.page.locator(`li:has(#nq-l-${kiranaId}) summary`, { hasText: "Questions for applicants" }).click();
  await adm.page.locator(`#nq-l-${kiranaId}`).fill("E2E Brands stocked");
  await adm.page.locator(`form:has(#nq-l-${kiranaId})`).getByRole("button", { name: "Add question" }).click();
  await adm.page.getByText("Saved.").waitFor({ timeout: 20000 });
  check("an admin defines a required list question and an optional text question; both audited",
    psql(`SELECT string_agg(key || ':' || field_type || ':' || is_required, ',' ORDER BY key) FROM category_attributes WHERE label LIKE 'E2E %'`) === "e2e_brands_stocked:text:false,e2e_shop_size:choice:true"
      && psql(`SELECT count(*) FROM audit_logs WHERE action = 'category_attribute.created'`) === "2");

  await cust.page.goto("/merchant/apply");
  await cust.page.getByLabel("Shop / business name").fill("E2E Taxonomy Shop");
  await cust.page.locator("#category_id").selectOption({ label: "Kirana" });
  check("choosing the category shows its subcategories and its extra questions",
    (await cust.page.locator("#subcategory_id option", { hasText: "E2E Staples" }).count()) === 1 && (await cust.page.getByLabel("E2E Shop size").count()) === 1 && (await cust.page.getByLabel("E2E Brands stocked (optional)").count()) === 1);
  await cust.page.locator("#category_id").selectOption({ label: "Salons" });
  check("choosing another category removes them (the questions belong to one category)",
    (await cust.page.locator("#subcategory_id").count()) === 0 && (await cust.page.getByLabel("E2E Shop size").count()) === 0);
  await cust.page.locator("#category_id").selectOption({ label: "Kirana" });
  await cust.page.locator("#locality_id").selectOption({ label: "Gandhi Chowk" });
  await cust.page.getByLabel("Shop phone").fill("+919848099222");
  await cust.page.getByLabel("Address", { exact: true }).fill("Opposite the Town Hall, Khammam");
  await cust.page.locator("#business_description").fill("Staples and daily needs");
  await cust.page.locator("#subcategory_id").selectOption({ label: "E2E Staples" });
  await cust.page.getByLabel("E2E Brands stocked (optional)").fill("Fortune, Aashirvaad");
  await cust.page.locator('input[name="operating_models"][value="visit_only"]').check();
  await cust.page.locator('input[name="declaration_accepted"]').check();
  await cust.page.getByRole("button", { name: /submit/i }).first().click();
  await cust.page.getByText(/must be answered/).first().waitFor({ timeout: 20000 });
  check("submitting without the mandatory question is refused with a clear sentence, and nothing typed is lost",
    /\/merchant\/apply/.test(cust.page.url()) && (await cust.page.getByLabel("Shop / business name").inputValue()) === "E2E Taxonomy Shop"
      && (await cust.page.getByLabel("E2E Brands stocked (optional)").inputValue()) === "Fortune, Aashirvaad" && psql(`SELECT count(*) FROM merchant_applications WHERE business_name = 'E2E Taxonomy Shop'`) === "0");
  await cust.page.getByLabel("E2E Shop size").selectOption("Large");
  await cust.page.getByRole("button", { name: /submit/i }).first().click();
  await cust.page.waitForURL(/\/merchant\/applications\//, { timeout: 20000 });
  check("with the mandatory answer the application is submitted and the answers and subcategory are stored",
    psql(`SELECT status || '|' || category_specific_data::text || '|' || (SELECT name FROM subcategories WHERE id = subcategory_id) FROM merchant_applications WHERE business_name = 'E2E Taxonomy Shop'`)
      === 'submitted|{"e2e_shop_size": "Large", "e2e_brands_stocked": "Fortune, Aashirvaad"}|E2E Staples');

  await adm.page.goto("/admin/applications");
  await adm.page.getByRole("link", { name: /E2E Taxonomy Shop/ }).first().click();
  await adm.page.getByRole("button", { name: /Approve & publish storefront/ }).click();
  await adm.page.getByRole("link", { name: /Open storefront/ }).waitFor({ timeout: 30000 });
  check("approval copies the answers and the subcategory onto the new shop",
    psql(`SELECT category_details::text || '|' || (SELECT name FROM subcategories WHERE id = subcategory_id) FROM shops WHERE name = 'E2E Taxonomy Shop'`)
      === '{"e2e_shop_size": "Large", "e2e_brands_stocked": "Fortune, Aashirvaad"}|E2E Staples');
  const tax = await newUserPage("taxanon");
  const taxPage = await tax.page.goto("/shop/e2e-taxonomy-shop-gandhi-chowk");
  const taxBody = await tax.page.locator("main, article").first().innerText();
  check("the public page shows the answers under their questions and links the subcategory",
    taxPage.status() === 200 && /More about this shop/.test(taxBody) && /E2E Shop size\s*\n?\s*Large/.test(taxBody) && /Fortune, Aashirvaad/.test(taxBody) && (await tax.page.getByRole("link", { name: "E2E Staples" }).count()) === 1);
  await tax.page.goto("/category/kirana");
  check("the category page offers the subcategory as a shortcut", (await tax.page.getByRole("navigation", { name: /subcategories/i }).getByRole("link", { name: "E2E Staples" }).count()) === 1);
  await tax.page.goto("/search?q=E2E%20Staples");
  check("customers can search by the subcategory name", (await tax.page.getByText("E2E Taxonomy Shop").count()) > 0);

  console.log("\n— Help Me Find It through the form —");
  await cust.page.goto("/help-me-find-it");
  await cust.page.getByLabel("What are you looking for?").fill("Wood-pressed sesame oil 5L");
  await cust.page.locator("#locality_id").selectOption({ label: "Gandhi Chowk" });
  // First try WITHOUT the consent tick: validation must fail and must not wipe what was typed.
  await cust.page.getByRole("button", { name: "Send request" }).click();
  await cust.page.locator('[role="alert"]').first().waitFor({ timeout: 20000 });
  check(
    "a failed Help Me Find It submit keeps the typed item and the chosen area",
    (await cust.page.getByLabel("What are you looking for?").inputValue()) === "Wood-pressed sesame oil 5L" &&
      (await cust.page.locator("#locality_id").evaluate((el) => el.options[el.selectedIndex]?.text)) === "Gandhi Chowk",
  );
  await cust.page.locator('input[name="consent_given"]').check();
  await cust.page.getByRole("button", { name: "Send request" }).click();
  await cust.page.getByText(/HMF-KHM-\d{6}-\d{4}/).first().waitFor({ timeout: 20000 });
  const tid = (await cust.page.getByText(/HMF-KHM-\d{6}-\d{4}/).first().innerText()).match(/HMF-KHM-\d{6}-\d{4}/)[0];
  check("the customer receives a server-generated tracking ID", /^HMF-KHM-\d{6}-\d{4}$/.test(tid), tid);
  await cust.page.goto("/account/requests");
  check("it appears under the customer's own requests", (await cust.page.getByText(tid).count()) > 0);
  await oth.page.goto("/account/requests");
  check("another customer does not see it", (await oth.page.getByText(tid).count()) === 0);

  console.log("\n— Shop notice: temporary closure and announcement (shopkeeper edits, public sees) —");
  await mer.page.goto(`/merchant/shops/${shopId}`);
  await mer.page.getByLabel("Announcement (optional)").fill("Festival offer on staples this week");
  await mer.page.getByLabel("Temporarily closed? Say why (optional)").fill("Closed for the festival");
  await mer.page.getByLabel("Closed until (optional)").fill("2020-01-01");
  await mer.page.getByRole("button", { name: "Save changes" }).click();
  await mer.page.getByText("The date cannot be in the past").waitFor({ timeout: 20000 });
  check("a closing date in the past is refused with a clear sentence, and what was typed stays",
    (await mer.page.getByLabel("Announcement (optional)").inputValue()) === "Festival offer on staples this week" && psql(`SELECT count(*) FROM storefronts WHERE slug = '${slug}' AND closure_note IS NOT NULL`) === "0");
  await mer.page.getByLabel("Closed until (optional)").fill("2099-01-01");
  await mer.page.getByRole("button", { name: "Save changes" }).click();
  await mer.page.getByText(/Changes saved/).waitFor({ timeout: 20000 });
  check("the shopkeeper's notice is stored", psql(`SELECT announcement || '|' || closure_note || '|' || closed_until FROM storefronts WHERE slug = '${slug}'`) === "Festival offer on staples this week|Closed for the festival|2099-01-01");
  const notice = await newUserPage("noticeanon");
  await notice.page.goto(`/shop/${slug}`);
  const noticeText = await notice.page.locator("article").innerText();
  check("the public page says the shop is temporarily closed, until when, why, and shows the announcement",
    /Temporarily closed until 1 Jan 2099/.test(noticeText) && /Closed for the festival/.test(noticeText) && /Festival offer on staples this week/.test(noticeText) && !/Open now/.test(noticeText));
  await mer.page.getByLabel("Temporarily closed? Say why (optional)").fill("");
  await mer.page.getByLabel("Closed until (optional)").fill("");
  await mer.page.getByLabel("Announcement (optional)").fill("");
  await mer.page.getByRole("button", { name: "Save changes" }).click();
  // The "Changes saved" banner from the previous save is still on screen, so wait for the database itself.
  for (let i = 0; i < 80 && psql(`SELECT count(*) FROM storefronts WHERE slug = '${slug}' AND (announcement IS NOT NULL OR closure_note IS NOT NULL OR closed_until IS NOT NULL)`) !== "0"; i++) await new Promise((r) => setTimeout(r, 250));
  await notice.page.goto(`/shop/${slug}`);
  check("clearing the notice reopens the page at once (note, date and announcement all gone)",
    !/Temporarily closed|Festival offer/.test(await notice.page.locator("article").innerText()) && psql(`SELECT count(*) FROM storefronts WHERE slug = '${slug}' AND (announcement IS NOT NULL OR closure_note IS NOT NULL OR closed_until IS NOT NULL)`) === "0");

  console.log("\n— Homepage layout: hide, show and move sections without a redeploy —");
  await adm.page.goto("/admin/homepage");
  await adm.page.getByRole("button", { name: "Hide Areas", exact: true }).click();
  await adm.page.getByText("Saved.").waitFor({ timeout: 20000 });
  const lay = await newUserPage("layoutanon");
  await lay.page.goto("/");
  check("a hidden section disappears from the public homepage", (await lay.page.locator("#areas-h").count()) === 0 && (await lay.page.locator("#cats-h").count()) === 1);
  await adm.page.goto("/admin/homepage");
  await adm.page.getByRole("button", { name: "Show Areas", exact: true }).click();
  await adm.page.getByText("Saved.").waitFor({ timeout: 20000 });
  await adm.page.goto("/admin/homepage");
  await adm.page.locator("#so-areas").fill("5");
  await adm.page.getByRole("button", { name: "Save order of Areas" }).click();
  await adm.page.getByText("Saved.").waitFor({ timeout: 20000 });
  await lay.page.goto("/");
  check("moving a section changes the real page order (Areas now comes before Categories)",
    await lay.page.evaluate(() => { const a = document.getElementById("areas-h"), c = document.getElementById("cats-h"); return !!a && !!c && !!(a.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING); }));
  check("every layout change (hide, show, move) is audited", psql(`SELECT count(*) FROM audit_logs WHERE action = 'homepage_section.changed' AND new_state->>'section' = 'areas'`) === "3");
  await adm.page.goto("/admin/homepage");
  await adm.page.locator("#so-areas").fill("70");
  await adm.page.getByRole("button", { name: "Save order of Areas" }).click();
  await adm.page.getByText("Saved.").waitFor({ timeout: 20000 });
  check("the layout is back to the default order afterwards", psql(`SELECT string_agg(section_key || ':' || is_visible, ',' ORDER BY display_order) FROM homepage_sections`) === "banners:true,featured:true,categories:true,stores:true,items:true,community:true,areas:true");
  check("a customer cannot reach the layout controls", (await denied(cust.page, "/admin/homepage", /Page sections|Banners/)).ok);

  console.log("\n— Assigning a Help Me Find It request to an operator —");
  const reqId = psql(`SELECT id FROM help_me_find_it_requests WHERE tracking_id = '${tid}'`);
  psql(`INSERT INTO user_roles (user_id, role) SELECT id, 'operator' FROM profiles WHERE email = '${users.other.email}' ON CONFLICT DO NOTHING`);
  await adm.page.goto(`/admin/help-requests/${reqId}`);
  await adm.page.locator("#operator_id").selectOption({ label: `${users.other.name} (operator)` });
  await adm.page.getByRole("button", { name: "Save assignment" }).click();
  await adm.page.getByText("Request assigned.").waitFor({ timeout: 20000 });
  check("an administrator assigns the request to a named operator; it is audited and the customer is not messaged",
    psql(`SELECT p.email FROM help_me_find_it_requests r JOIN profiles p ON p.id = r.operator_id WHERE r.id = '${reqId}'`) === users.other.email
      && psql(`SELECT count(*) FROM audit_logs WHERE action = 'help_request.assigned' AND entity_id = '${reqId}'`) === "1"
      && psql(`SELECT status FROM help_me_find_it_requests WHERE id = '${reqId}'`) === "pending");
  await oth.page.goto(`/admin/help-requests/${reqId}`);
  const opText = await oth.page.locator("main").innerText();
  check("the operator sees the request is theirs but cannot change the assignment (no form, only the sentence)",
    /Assigned to Other Omkar/.test(opText) && (await oth.page.locator("#operator_id").count()) === 0);
  psql(`DELETE FROM user_roles WHERE role = 'operator' AND user_id = (SELECT id FROM profiles WHERE email = '${users.other.email}')`);

  console.log("\n— Resubmitted application: the administrator sees exactly what changed —");
  await oth.page.goto("/merchant/apply");
  await oth.page.getByLabel("Shop / business name").fill("E2E Diff Shop");
  await oth.page.locator("#category_id").selectOption({ label: "Kirana" });
  await oth.page.locator("#locality_id").selectOption({ label: "Gandhi Chowk" });
  await oth.page.getByLabel("Shop phone").fill("+919848099333");
  await oth.page.getByLabel("Address", { exact: true }).fill("Old diff address, Khammam");
  await oth.page.getByLabel("E2E Shop size").selectOption("Small");
  await oth.page.locator('input[name="operating_models"][value="visit_only"]').check();
  await oth.page.locator('input[name="declaration_accepted"]').check();
  await oth.page.getByRole("button", { name: /submit/i }).first().click();
  await oth.page.waitForURL(/\/merchant\/applications\//, { timeout: 20000 });
  const diffAppId = psql(`SELECT id FROM merchant_applications WHERE business_name = 'E2E Diff Shop'`);
  await adm.page.goto(`/admin/applications/${diffAppId}`);
  check("a first submission shows no comparison (nothing to compare with)", (await adm.page.getByText("What changed since you asked for corrections").count()) === 0);
  await adm.page.locator("#notes").fill("Please give the full address");
  await adm.page.getByRole("button", { name: "Send back to applicant" }).click();
  for (let i = 0; i < 60 && psql(`SELECT status FROM merchant_applications WHERE id = '${diffAppId}'`) !== "correction_requested"; i++) await new Promise((r) => setTimeout(r, 250));
  check("requesting corrections keeps a snapshot of what the administrator saw", psql(`SELECT review_snapshot->>'address_line1' FROM merchant_applications WHERE id = '${diffAppId}'`) === "Old diff address, Khammam");
  await oth.page.goto(`/merchant/applications/${diffAppId}`);
  await oth.page.getByLabel("Address", { exact: true }).fill("12-3-45, Full new address, Khammam");
  await oth.page.getByRole("button", { name: /submit/i }).first().click();
  await oth.page.waitForURL(/submitted=1/, { timeout: 20000 });
  await adm.page.goto(`/admin/applications/${diffAppId}`);
  const diffText = await adm.page.locator("main, body").first().innerText();
  check("after the resubmission the administrator sees a before/after row for the address and for nothing else",
    /What changed since you asked for corrections/.test(diffText) && /Old diff address, Khammam/.test(diffText) && /12-3-45, Full new address, Khammam/.test(diffText)
      && (await adm.page.locator("table:has(caption)").first().locator("tbody tr").count()) === 1);

  console.log("\n— Moderation visible to the public —");
  await adm.page.goto("/admin/storefronts");
  // Act on this test's own shop: the list now holds the other shops approved earlier in this script too.
  const ownRow = adm.page.locator("li", { hasText: "E2E Sri Ram Kirana" });
  await ownRow.getByLabel(/Reason/).fill("Complaint under review");
  await ownRow.getByRole("button", { name: "Suspend" }).click();
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