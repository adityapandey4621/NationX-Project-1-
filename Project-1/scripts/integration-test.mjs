#!/usr/bin/env node
// Local integration test: the real, built Next.js app talking over HTTP to a real
// PostgREST + Postgres (row-level security enforced) — no Supabase account needed.
//
//   npm run test:integration        (requires Docker running)
//
// What is real: the Next app (production build), every migration + seed, PostgREST,
// RLS, the SQL workflow functions, the API routes and server-rendered pages.
// What is NOT real: Supabase Auth (GoTrue) and Storage. A tiny gateway below
// validates test-minted JWTs and answers `/auth/v1/user`; users authenticate with
// `Authorization: Bearer` tokens. So this proves the data/permission behaviour of
// the customer journeys, not the sign-up/sign-in UX against real Supabase Auth.
import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import http from "node:http";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SECRET = "integration-test-secret-integration-test-secret";
const NET = "nx-int";
const DB = "nx-int-db";
const REST = "nx-int-rest";
const REST_PORT = 3101;
const GATEWAY_PORT = 54399;
const APP_PORT = 3199;
const APP = `http://127.0.0.1:${APP_PORT}`;
const DIST = ".next-integration";

// ---------------------------------------------------------------- helpers
const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
function jwt(claims) {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const p = b64({ iss: "nx-int", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, ...claims });
  return `${h}.${p}.${createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
}
function verify(token) {
  const [h, p, s] = (token ?? "").split(".");
  if (!h || !p || !s) return null;
  if (createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url") !== s) return null;
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  return claims.exp > Date.now() / 1000 ? claims : null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function docker(args, { quiet = true, input } = {}) {
  const r = spawnSync("docker", args, { encoding: "utf8", input });
  if (!quiet && r.stdout) process.stdout.write(r.stdout);
  return r;
}
function psql(sql) {
  const r = docker(["exec", "-i", DB, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-tA"], { input: sql });
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr}\n${sql.slice(0, 300)}`);
  return r.stdout.trim();
}
function psqlFile(file) {
  const r = docker(["exec", DB, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", `/work/${file}`]);
  if (r.status !== 0) throw new Error(`${file} failed:\n${r.stderr}`);
}

let passed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` (${detail})` : ""}`);
}

async function call(method, urlPath, { token, json, form, headers = {} } = {}) {
  const res = await fetch(`${APP}${urlPath}`, {
    method,
    redirect: "manual",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { "Content-Type": "application/json" } : {}), ...headers },
    body: form ?? (json ? JSON.stringify(json) : undefined),
  });
  // React inserts <!-- --> between adjacent text fragments; drop them so text assertions read naturally.
  const text = (await res.text()).replace(/<!-- -->/g, "");
  let body = null;
  try { body = JSON.parse(text); } catch { /* HTML */ }
  return { status: res.status, text, body, location: res.headers.get("location"), headers: res.headers };
}

// ---------------------------------------------------------------- stack
let gateway;
let appProc;
async function startStack() {
  docker(["rm", "-f", DB, REST]);
  docker(["network", "rm", NET]);
  docker(["network", "create", NET]);
  const run = docker(["run", "-d", "--rm", "--name", DB, "--network", NET, "--tmpfs", "/var/lib/postgresql/data", "-e", "POSTGRES_PASSWORD=pw", "postgres:16-alpine"]);
  if (run.status !== 0) throw new Error(`could not start Postgres: ${run.stderr}`);
  for (let i = 0; i < 80; i++) {
    if (docker(["exec", DB, "psql", "-U", "postgres", "-tAc", "select 1"]).stdout?.trim() === "1") break;
    await sleep(500);
  }
  docker(["cp", path.join(root, "supabase"), `${DB}:/work`]);
  psqlFile("tests/stub_supabase.sql");
  psql("CREATE ROLE authenticator LOGIN PASSWORD 'pw' NOINHERIT; GRANT anon, authenticated, service_role TO authenticator;");
  for (const f of readdirSync(path.join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort()) psqlFile(`migrations/${f}`);
  psqlFile("seed.sql");

  const rest = docker([
    "run", "-d", "--rm", "--name", REST, "--network", NET, "-p", `127.0.0.1:${REST_PORT}:3000`,
    "-e", `PGRST_DB_URI=postgres://authenticator:pw@${DB}:5432/postgres`, "-e", "PGRST_DB_SCHEMAS=public",
    "-e", "PGRST_DB_ANON_ROLE=anon", "-e", `PGRST_JWT_SECRET=${SECRET}`, "-e", "PGRST_DB_POOL=5",
    "postgrest/postgrest:v12.2.3",
  ]);
  if (rest.status !== 0) throw new Error(`could not start PostgREST: ${rest.stderr}`);
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://127.0.0.1:${REST_PORT}/`)).ok) break; } catch { /* not up yet */ }
    await sleep(500);
  }
}

/** Minimal stand-in for Supabase's edge: `/rest/v1/*` → PostgREST, `/auth/v1/user` → JWT check. */
function startGateway(anonKey) {
  gateway = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const auth = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (url.pathname === "/auth/v1/user") {
      const c = verify(auth);
      if (!c || c.role !== "authenticated" || !c.sub) {
        res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ code: 401, error_code: "bad_jwt", msg: "invalid JWT" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: c.sub, aud: "authenticated", role: "authenticated", email: c.email ?? null, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }));
      return;
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      const chunks = [];
      for await (const ch of req) chunks.push(ch);
      const headers = { ...req.headers };
      delete headers.host; delete headers.connection; delete headers["content-length"]; delete headers.apikey;
      if (auth === anonKey) delete headers.authorization; // anon requests carry the anon key only
      const upstream = await fetch(`http://127.0.0.1:${REST_PORT}${url.pathname.slice("/rest/v1".length)}${url.search}`, {
        method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
      });
      const out = Buffer.from(await upstream.arrayBuffer());
      const h = Object.fromEntries([...upstream.headers].filter(([k]) => !["content-encoding", "transfer-encoding", "content-length", "connection"].includes(k)));
      res.writeHead(upstream.status, h).end(out);
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((r) => gateway.listen(GATEWAY_PORT, "127.0.0.1", r));
}

function build(env) {
  console.log("Building the app (production) …");
  const r = spawnSync(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "build"], { cwd: root, env, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`build failed:\n${r.stdout}\n${r.stderr}`);
}
let extraProc;
async function startApp(env, port = APP_PORT, extra = false) {
  const proc = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "start", "-p", String(port)], { cwd: root, env, stdio: "ignore" });
  if (extra) extraProc = proc; else appProc = proc;
  for (let i = 0; i < 80; i++) {
    try { await fetch(`http://127.0.0.1:${port}/api/health`); return; } catch { await sleep(500); }
  }
  throw new Error("app did not start");
}

async function stopStack() {
  appProc?.kill();
  extraProc?.kill();
  await new Promise((r) => (gateway ? gateway.close(r) : r()));
  docker(["rm", "-f", DB, REST]);
  docker(["network", "rm", NET]);
}

// ---------------------------------------------------------------- scenarios
async function scenarios() {
  const uid = {
    applicantA: randomUUID(), applicantB: randomUUID(), admin: randomUUID(), operator: randomUUID(),
    customer1: randomUUID(), customer2: randomUUID(),
  };
  psql(`
    INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
      ('${uid.applicantA}', 'a@example.test', '{"full_name":"Applicant A","phone":"+919000000001"}'),
      ('${uid.applicantB}', 'b@example.test', '{"full_name":"Applicant B","phone":"+919000000002"}'),
      ('${uid.admin}', 'admin@example.test', '{"full_name":"Admin","phone":"+919000000003"}'),
      ('${uid.operator}', 'op@example.test', '{"full_name":"Operator","phone":"+919000000004"}'),
      ('${uid.customer1}', 'c1@example.test', '{"full_name":"Customer One","phone":"+919000000005"}'),
      ('${uid.customer2}', 'c2@example.test', '{"full_name":"Customer Two","phone":"+919000000006"}');
    INSERT INTO user_roles (user_id, role) VALUES ('${uid.admin}', 'admin'), ('${uid.operator}', 'operator');`);
  const tok = Object.fromEntries(Object.entries(uid).map(([k, v]) => [k, jwt({ sub: v, role: "authenticated", email: `${k}@example.test` })]));

  console.log("\n— Empty directory: nothing is fabricated —");
  let r = await call("GET", "/");
  check("homepage renders (200) with the viewport meta tag", r.status === 200 && /name="viewport"/.test(r.text));
  check("empty homepage says no shops are listed (no demo businesses)", /No stores are listed yet/.test(r.text) && !/Sri Ram/.test(r.text));
  check("homepage lists seeded categories and areas from the database", /Kirana/.test(r.text) && /Gandhi Chowk/.test(r.text) && /Pharmacy/.test(r.text));
  check("homepage offers Help me find it and Add your shop", /Help me find it/.test(r.text) && /Add your shop/.test(r.text));
  check("homepage never advertises unflagged modules", !/NationX Grocery/i.test(r.text) && !/Shared Delivery/i.test(r.text));
  r = await call("GET", "/search");
  check("search with no shops shows the empty state", r.status === 200 && /No shops are listed yet/.test(r.text));
  r = await call("GET", "/search?q=kirana");
  check("search with no match shows 'No stores found' and offers Help me find it", /No stores found/.test(r.text) && /Ask us to find it/.test(r.text) && /item=kirana/.test(r.text));
  check("category page for a real category is 200", (await call("GET", "/category/kirana")).status === 200);
  check("category page for an unknown category is a real 404", (await call("GET", "/category/does-not-exist")).status === 404);
  check("locality page for a real area is 200", (await call("GET", "/locality/gandhi-chowk")).status === 200);
  check("locality page for an unknown area is a real 404", (await call("GET", "/locality/nowhere")).status === 404);
  check("unknown storefront is a real 404", (await call("GET", "/shop/no-such-shop")).status === 404);

  console.log("\n— Merchant application → admin approval → published storefront —");
  const tax = await call("GET", "/api/v1/taxonomy");
  const cat = tax.body.data.categories.find((c) => c.slug === "kirana").id;
  const gandhi = tax.body.data.localities.find((l) => l.slug === "gandhi-chowk").id;
  const wyra = tax.body.data.localities.find((l) => l.slug === "wyra-road").id;
  const application = (name, phone, extra = {}) => ({
    action: "submit", business_name: name, category_id: cat, locality_id: gandhi, contact_phone: phone, whatsapp_number: phone,
    address_line1: "Near Old Bus Stand", pincode: "507001", business_description: "Daily groceries, grains and oils",
    opening_time: "08:30", closing_time: "21:00", weekly_off_days: ["tuesday"], operating_models: ["visit_only", "pickup"],
    declaration_accepted: true, ...extra,
  });
  r = await call("POST", "/api/v1/merchant/applications", { token: tok.applicantA, json: application("Sri Ram Kirana", "+919848011223") });
  check("applicant submits an application (201)", r.status === 201 && r.body.data.status === "submitted", JSON.stringify(r.body));
  const appA = r.body.data.application_id;
  r = await call("GET", "/search?q=sri+ram");
  check("a submitted (unapproved) shop is NOT in public search", /No stores found/.test(r.text) && !/Sri Ram Kirana/.test(r.text));
  check("...nor on its would-be page", (await call("GET", "/shop/sri-ram-kirana-gandhi-chowk")).status === 404);
  r = await call("POST", `/api/v1/admin/applications/${appA}/approve`, { token: tok.customer1, json: {} });
  check("a customer cannot approve (403)", r.status === 403);
  r = await call("POST", `/api/v1/admin/applications/${appA}/approve`, { json: {} });
  check("anonymous cannot approve (401)", r.status === 401);
  r = await call("POST", `/api/v1/admin/applications/${appA}/approve`, { token: tok.admin, json: { review_notes: "Verified in person" } });
  check("admin approves; storefront published", r.status === 200 && r.body.data.storefront.slug === "sri-ram-kirana-gandhi-chowk", JSON.stringify(r.body));
  r = await call("POST", `/api/v1/admin/applications/${appA}/approve`, { token: tok.admin, json: {} });
  check("repeating the approval is idempotent", r.status === 200 && r.body.data.already_approved === true);
  const slug = "sri-ram-kirana-gandhi-chowk";

  console.log("\n— Customer discovery on real, published data —");
  r = await call("GET", "/");
  check("homepage now shows the approved shop", /Sri Ram Kirana/.test(r.text) && /Explore local stores/.test(r.text) && !/No stores are listed yet/.test(r.text));
  check("homepage category count reflects the real record", /1 store/.test(r.text));
  for (const [label, q] of [["name", "sri+ram"], ["description", "groceries"], ["category", "kirana"], ["area", "gandhi"], ["PIN code", "507001"], ["spelling mistake", "kirna"]]) {
    r = await call("GET", `/search?q=${q}`);
    check(`search by ${label} finds the shop`, r.status === 200 && /Sri Ram Kirana/.test(r.text), `q=${q}`);
  }
  r = await call("GET", "/search?q=zzzzqqqq");
  check("search with no results shows the no-result state", /No stores found/.test(r.text) && !/Sri Ram Kirana/.test(r.text));
  r = await call("GET", "/search?q=%25%27%3B%20drop%20table%20shops%3B--");
  check("hostile query is treated as text (no error)", r.status === 200 && /No stores found/.test(r.text));
  r = await call("GET", "/search?q=" + "kirana+".repeat(60));
  check("very long query is handled", r.status === 200);
  r = await call("GET", "/search?category=kirana");
  check("category filter includes the shop", /Sri Ram Kirana/.test(r.text));
  r = await call("GET", "/search?category=pharmacy");
  check("category filter excludes other categories", !/Sri Ram Kirana/.test(r.text) && /No stores found/.test(r.text));
  r = await call("GET", "/search?locality=wyra-road");
  check("area filter excludes other areas", !/Sri Ram Kirana/.test(r.text));
  r = await call("GET", "/search?locality=gandhi-chowk&category=kirana&model=pickup");
  check("combined filters include a matching shop", /Sri Ram Kirana/.test(r.text));
  r = await call("GET", "/search?model=delivery");
  check("operating-model filter excludes shops without it", !/Sri Ram Kirana/.test(r.text));
  r = await call("GET", "/search?sort=bogus&page=-4&model=nonsense&category=%27");
  check("invalid sort/page/model/category values degrade gracefully", r.status === 200 && /Sri Ram Kirana/.test(r.text));
  r = await call("GET", "/category/kirana");
  check("category page lists the shop", r.status === 200 && /Sri Ram Kirana/.test(r.text));
  r = await call("GET", "/locality/gandhi-chowk");
  check("locality page lists the shop", /Sri Ram Kirana/.test(r.text));
  r = await call("GET", "/locality/wyra-road");
  check("another area's page does not", !/Sri Ram Kirana/.test(r.text));

  console.log("\n— Storefront navigation —");
  const back = encodeURIComponent("/search?q=kirana");
  r = await call("GET", `/search?q=kirana`);
  check("result cards link to the storefront and remember where you came from", r.text.includes(`/shop/${slug}?from=${back}`) || r.text.includes(`/shop/${slug}?from=%2Fsearch%3Fq%3Dkirana`));
  r = await call("GET", `/shop/${slug}?from=${back}`);
  check("storefront is public (200) with real details", r.status === 200 && /Sri Ram Kirana/.test(r.text) && /tel:\+919848011223/.test(r.text) && /Daily groceries/.test(r.text));
  check("storefront shows a back-to-results link", /Back to results/.test(r.text) && r.text.includes(`href="/search?q=kirana"`));
  check("storefront never shows ordering or invented stock", !/Add to cart/i.test(r.text) && !/In stock/.test(r.text));
  r = await call("GET", `/shop/${slug}?from=${encodeURIComponent("https://evil.example/phish")}`);
  check("an external 'from' URL is ignored (no link, no open redirect)", r.status === 200 && !/href="[^"]*evil\.example/.test(r.text) && !/Back to results/.test(r.text));
  r = await call("GET", `/shop/${slug}?from=${encodeURIComponent("/admin")}`);
  check("a non-listing 'from' path is ignored", !/Back to results/.test(r.text));

  console.log("\n— Pagination and sorting —");
  psql(`
    INSERT INTO businesses (id, name, primary_owner_id) VALUES ('${randomUUID()}', 'Extra Biz', '${uid.applicantB}');
    INSERT INTO shops (business_id, name, shop_code, category_id, locality_id, address_line, phone, pincode)
      SELECT (SELECT id FROM businesses WHERE name = 'Extra Biz'), 'Extra Kirana ' || lpad(i::text, 2, '0'), 'X' || i,
             (SELECT id FROM categories WHERE slug = 'kirana'), (SELECT id FROM localities WHERE slug = 'gandhi-chowk'),
             'Extra lane ' || i, '+9198000000' || lpad(i::text, 2, '0'), '507001'
      FROM generate_series(1, 13) AS i;
    INSERT INTO storefronts (shop_id, slug) SELECT id, 'extra-kirana-' || substr(shop_code, 2) FROM shops WHERE shop_code LIKE 'X%';`);
  r = await call("GET", "/search?q=kirana");
  check("14 matching shops → page 1 of 2 with 12 cards", /page 1 of 2/.test(r.text) && (r.text.match(/<article/g) ?? []).length === 12 && /Next →/.test(r.text) && !/← Previous/.test(r.text));
  const page2 = await call("GET", "/search?q=kirana&page=2");
  check("page 2 has the remaining 2 shops and a Previous link", (page2.text.match(/<article/g) ?? []).length === 2 && /← Previous/.test(page2.text) && !/Next →/.test(page2.text));
  r = await call("GET", "/search?q=kirana&page=9");
  check("a page beyond the end shows 'No more results'", /No more results/.test(r.text));
  r = await call("GET", "/search?sort=name");
  const names = [...r.text.matchAll(/<h3[^>]*><a[^>]*>([^<]+)<\/a><\/h3>/g)].map((m) => m[1]);
  check("sort by name is alphabetical", names.length > 3 && names.every((n, i) => i === 0 || names[i - 1].toLowerCase() <= n.toLowerCase()), names.slice(0, 4).join(" | "));
  r = await call("GET", "/api/v1/discovery/search?q=kirana&limit=5&offset=5");
  check("API search paginates with a total", r.status === 200 && r.body.data.total === 14 && r.body.data.results.length === 5 && r.body.data.results[0].type === "shop");
  check("API search never exposes page-level internals per row", r.body.data.results.every((x) => !("total_count" in x)));
  r = await call("GET", "/api/v1/discovery/search?limit=500");
  check("API rejects an oversized page", r.status === 400 && r.body.error.code === "VALIDATION_FAILED");
  r = await call("GET", "/api/v1/discovery/homepage");
  check("API homepage returns categories, areas, shops and module flags", r.status === 200 && r.body.data.categories.length === 5 && r.body.data.featured_shops.length === 6 && typeof r.body.data.active_modules === "object");

  console.log("\n— Marketplace pages (ADR-009) —");
  r = await call("GET", "/explore");
  check("/explore lists published stores with category tiles", r.status === 200 && /Explore local stores/.test(r.text) && (r.text.match(/<article/g) ?? []).length === 12 && /href="\/category\/kirana"/.test(r.text));
  r = await call("GET", "/explore?category=pharmacy");
  check("/explore filters by category", (r.text.match(/<article/g) ?? []).length === 0 && /No stores found/.test(r.text));
  r = await call("GET", "/api/v1/discovery/suggest?q=sri");
  check("suggest API returns real shop names", r.status === 200 && r.body.data.shops.some((s) => s.slug === slug && s.name === "Sri Ram Kirana"), JSON.stringify(r.body));
  r = await call("GET", "/api/v1/discovery/suggest?q=kira");
  check("suggest API matches categories by name", r.body.data.categories.some((c) => c.slug === "kirana"));
  r = await call("GET", "/api/v1/discovery/suggest?q=gand");
  check("suggest API matches areas by name", r.body.data.localities.some((l) => l.slug === "gandhi-chowk"));
  r = await call("GET", "/api/v1/discovery/suggest?q=s");
  check("suggest API returns nothing for a one-letter query", r.status === 200 && r.body.data.shops.length === 0 && r.body.data.categories.length === 0);
  r = await call("GET", "/api/v1/discovery/suggest?q=zzqqxx");
  check("suggest API returns empty lists when nothing matches", r.status === 200 && r.body.data.shops.length === 0);
  r = await call("GET", "/api/v1/discovery/search?q=sri+ram&limit=1");
  const row = r.body.data.results[0];
  check("search rows carry banner, template, hours, item count and sample flag; real approvals are never samples",
    row && "banner_url" in row && row.template_name === "grocery" && row.operating_hours?.opens === "08:30" && row.item_count === 0 && row.is_sample === false, JSON.stringify(row));
  r = await call("GET", "/api/v1/discovery/homepage");
  check("API homepage exposes recent_items (additive field)", Array.isArray(r.body.data.recent_items));
  r = await call("GET", "/");
  check("homepage shows the shop's own hours status and no invented ratings, offers or delivery times",
    /Open now|Closed now/.test(r.text) && !/★|\bratings?\b|% off|min delivery|Add to cart/i.test(r.text.replace(/<script[\s\S]*?<\/script>/g, "")));
  check("homepage has a skip link, a main landmark and a footer", /Skip to content/.test(r.text) && /<main id="main"/.test(r.text) && /<footer/.test(r.text));
  check("footer invents no contact details or social links", /Direct support contacts are not published yet/.test(r.text) && !/instagram\.com|facebook\.com|mailto:/.test(r.text));
  r = await call("GET", "/search?q=kirana", { headers: { cookie: "nx_locality=wyra-road" } });
  check("a remembered area scopes listings by default", /No stores found/.test(r.text) && /Search all areas/.test(r.text), "cookie name: see LOCALITY_COOKIE");
  r = await call("GET", "/search?q=kirana&locality=all", { headers: { cookie: "nx_locality=wyra-road" } });
  check("locality=all overrides the remembered area", !/No stores found/.test(r.text) && /page 1 of 2/.test(r.text));

  console.log("\n— Opt-in location, community counts and trust pages (Tranche 1) —");
  r = await call("GET", "/api/v1/discovery/search?q=sri+ram&limit=1");
  check("without a shared position, distance_km is null (never a guess)", r.body.data.results[0]?.distance_km === null, JSON.stringify(r.body.data.results[0]));
  r = await call("GET", "/api/v1/discovery/search?q=sri+ram&limit=1&lat=17.2473&lng=80.1514");
  check("a shop with no recorded coordinates still has null distance even when a position is shared", r.body.data.results[0]?.distance_km === null);
  psql(`UPDATE shops SET latitude = 17.2923, longitude = 80.1514 WHERE id = (SELECT shop_id FROM storefronts WHERE slug = '${slug}');`);
  r = await call("GET", "/api/v1/discovery/search?q=sri+ram&limit=1&lat=17.2473&lng=80.1514&sort=nearest");
  const dist = r.body.data.results[0]?.distance_km;
  check("API returns a real distance (~5 km) when a position is shared and the shop has coordinates", r.status === 200 && dist > 4.8 && dist < 5.2, String(dist));
  r = await call("GET", "/api/v1/discovery/search?lat=91&lng=10");
  check("API rejects an out-of-range latitude", r.status === 400 && r.body.error.code === "VALIDATION_FAILED");
  r = await call("GET", "/search?q=sri+ram", { headers: { cookie: "nx_near=17.247,80.151" } });
  check("the shared-position cookie shows distances and the stop control, and the Nearest sort", /5\.\d km away/.test(r.text) && /Stop using my location/.test(r.text) && /Nearest first/.test(r.text), r.text.slice(0, 0));
  r = await call("GET", "/search?q=sri+ram", { headers: { cookie: "nx_near=not-a-position" } });
  check("a malformed position cookie is ignored", !/km away/.test(r.text) && /Use my location/.test(r.text));
  r = await call("GET", "/search?q=sri+ram");
  check("without the cookie there is an opt-in button and a plain explanation, and no distances", /Use my location/.test(r.text) && /kept on this device for 2 hours/.test(r.text) && !/km away/.test(r.text));
  r = await call("GET", "/api/v1/discovery/homepage");
  check("API homepage exposes real per-area counts (additive)", Array.isArray(r.body.data.community) && r.body.data.community.reduce((n, c) => n + c.shop_count, 0) >= 1);
  r = await call("GET", "/");
  check("homepage community strip states real counts only", /shops? live|shop live/.test(r.text) && !/trending|selling fast|only \d+ left|hurry/i.test(r.text));
  for (const [p, h1] of [["/sell", /Let your neighbourhood find your shop/], ["/about", /About NationX/], ["/contact", /Contact/], ["/privacy", /Privacy/], ["/terms", /Terms of use/]]) {
    r = await call("GET", p);
    check(`${p} renders`, r.status === 200 && h1.test(r.text));
  }
  check("legal pages are labelled as drafts until reviewed", /not yet been reviewed by a lawyer/.test((await call("GET", "/privacy")).text) && /not yet been reviewed by a lawyer/.test((await call("GET", "/terms")).text));
  r = await call("GET", "/sell");
  check("/sell makes no money, speed or volume claims", !/₹|\bRs\.?\s?\d|% more|guarantee|double your/i.test(r.text.replace(/<script[\s\S]*?<\/script>/g, "")));
  r = await call("GET", `/shop/${slug}`);
  check("storefront shows Verified by NationX, a share button and a QR poster link", /Verified by NationX/.test(r.text) && />Share</.test(r.text) && new RegExp(`/shop/${slug}/poster`).test(r.text));
  r = await call("GET", `/shop/${slug}/poster`);
  check("the QR poster renders an inline SVG QR code for the shop link", r.status === 200 && /<svg[^>]*viewBox/.test(r.text) && new RegExp(`/shop/${slug}`).test(r.text));
  check("a poster for an unknown shop is a 404", (await call("GET", "/shop/no-such-shop-zz/poster")).status === 404);
  check("the footer links to the trust pages", /href="\/privacy"/.test((await call("GET", "/")).text) && /href="\/terms"/.test((await call("GET", "/")).text) && /href="\/about"/.test((await call("GET", "/")).text));
  console.log("\n— Integration API for the Grocery / Delivery products (ADR-010) —");
  r = await call("GET", "/api/v1/integration/events");
  check("integration endpoints refuse a request with no key (401 + WWW-Authenticate)", r.status === 401 && r.body.error.code === "UNAUTHENTICATED" && /Bearer/.test(r.headers.get("www-authenticate") ?? ""));
  r = await call("GET", "/api/v1/integration/events", { token: "nxsk_" + "a".repeat(43) });
  check("an unknown key is refused without saying whether it exists", r.status === 401 && r.body.error.message === "A valid service key is required");
  r = await call("GET", "/api/v1/integration/shops", { token: tok.admin });
  check("a signed-in user session (even an admin's) is NOT a service key", r.status === 401);
  r = await call("POST", "/api/v1/admin/service-clients", { token: tok.merchantA ?? tok.applicantB, json: { name: "Rogue", scopes: ["events:read"] } });
  check("a non-admin cannot create a service client", r.status === 403, String(r.status));
  r = await call("POST", "/api/v1/admin/service-clients", { json: { name: "Rogue", scopes: ["events:read"] } });
  check("an anonymous caller cannot create a service client", r.status === 401);
  r = await call("POST", "/api/v1/admin/service-clients", { token: tok.admin, json: { name: "Grocery (P2)", scopes: ["admin:everything"] } });
  check("an unknown scope is refused", r.status === 400 && r.body.error.code === "VALIDATION_FAILED");
  r = await call("POST", "/api/v1/admin/service-clients", { token: tok.admin, json: { name: "Grocery (P2)", scopes: ["events:read", "reference:read"] } });
  const svcKey = r.body?.data?.key;
  const svcId = r.body?.data?.client?.id;
  check("an admin creates a service client and receives the key once", r.status === 201 && /^nxsk_[A-Za-z0-9_-]{43}$/.test(svcKey) && r.headers.get("cache-control") === "no-store", JSON.stringify(r.body).slice(0, 200));
  check("the creation response never includes the key hash", !/key_hash|"hash"/.test(r.text));
  r = await call("GET", "/api/v1/admin/service-clients", { token: tok.admin });
  check("the client list shows the prefix, scopes and usage but never the key or its hash",
    r.status === 200 && r.body.data.clients.some((c) => c.id === svcId && c.key_prefix === svcKey.slice(0, 9)) && !r.text.includes(svcKey) && !/key_hash/.test(r.text));
  check("a non-admin cannot list clients", (await call("GET", "/api/v1/admin/service-clients", { token: tok.applicantB })).status === 403);

  r = await call("GET", "/api/v1/integration/events?limit=500", { token: svcKey });
  const evs = r.body?.data?.events ?? [];
  check("the change feed returns committed storefront events in sequence order", r.status === 200 && evs.length > 0 && evs.every((e, i) => i === 0 || e.seq > evs[i - 1].seq), JSON.stringify(r.body).slice(0, 200));
  check("the approved shop appears as a storefront.created event carrying reference data (ids, slug, locality, category)",
    evs.some((e) => e.event_type === "storefront.created" && e.payload.slug === slug && e.payload.category_slug === "kirana" && e.payload.locality_slug && e.payload.shop_id));
  check("event payloads carry no phone numbers, emails or addresses", !/\+91|phone|whatsapp|@example|address/i.test(JSON.stringify(evs.map((e) => e.payload))));
  check("every event has a unique event_id", new Set(evs.map((e) => e.event_id)).size === evs.length);
  check("every event declares its payload version (1 today)", evs.length > 0 && evs.every((e) => e.schema_version === 1));
  check("the feed reports the retention marker and no gap when nothing has been purged", r.body.data.purged_through === 0 && r.body.data.gap === false, JSON.stringify({ p: r.body.data.purged_through, g: r.body.data.gap }));
  const cursor = r.body.data.next_cursor;
  r = await call("GET", `/api/v1/integration/events?after=${cursor}`, { token: svcKey });
  check("resuming from next_cursor returns nothing new and keeps the cursor", r.status === 200 && r.body.data.events.length === 0 && r.body.data.next_cursor === cursor && r.body.data.has_more === false);
  r = await call("GET", "/api/v1/integration/events?limit=1", { token: svcKey });
  check("paging works: limit 1 reports has_more", r.status === 200 && r.body.data.events.length === 1 && r.body.data.has_more === true);
  check("a bad cursor is a validation error", (await call("GET", "/api/v1/integration/events?after=-5", { token: svcKey })).status === 400);

  r = await call("GET", "/api/v1/integration/shops", { token: svcKey });
  const shopRef = r.body?.data?.shops?.find((s) => s.slug === slug);
  check("shop references list live shops with location, category and locality", r.status === 200 && shopRef && shopRef.category_slug === "kirana" && Math.abs(shopRef.latitude - 17.2923) < 1e-6 && shopRef.ordering_enabled === false, JSON.stringify(shopRef));
  r = await call("GET", `/api/v1/integration/shops/${shopRef?.shop_id}`, { token: svcKey });
  check("a single shop reference can be fetched", r.status === 200 && r.body.data.slug === slug);
  check("an unknown shop id is a 404", (await call("GET", "/api/v1/integration/shops/00000000-0000-4000-8000-000000000000", { token: svcKey })).status === 404);
  check("a malformed shop id is a validation error", (await call("GET", "/api/v1/integration/shops/not-a-uuid", { token: svcKey })).status === 400);
  r = await call("GET", "/api/v1/integration/shops?locality=wyra-road&limit=1", { token: svcKey });
  check("the locality filter and page size are honoured", r.status === 200 && r.body.data.shops.length <= 1 && r.body.data.shops.every((s) => s.locality_slug === "wyra-road"));
  r = await call("GET", "/api/v1/integration/feature-flags", { token: svcKey });
  check("feature flags are readable with reference:read", r.status === 200 && Array.isArray(r.body.data.flags));

  r = await call("POST", "/api/v1/admin/service-clients", { token: tok.admin, json: { name: "Delivery (P3)", scopes: ["reference:read"] } });
  const readOnlyKey = r.body.data.key;
  check("a key without events:read cannot read the feed (403, not 401)", (await call("GET", "/api/v1/integration/events", { token: readOnlyKey })).status === 403);
  check("...but can read shop references", (await call("GET", "/api/v1/integration/shops?limit=1", { token: readOnlyKey })).status === 200);

  r = await call("GET", "/api/v1/integration/openapi");
  check("the OpenAPI contract is public and describes every integration path",
    r.status === 200 && r.body.openapi === "3.1.0" && ["/api/v1/integration/events", "/api/v1/integration/shops", "/api/v1/integration/shops/{shopId}", "/api/v1/integration/feature-flags"].every((p) => p in r.body.paths));

  r = await call("POST", `/api/v1/admin/service-clients/${svcId}/revoke`, { token: tok.admin, json: { reason: "rotated" } });
  check("an admin can revoke a client", r.status === 200 && r.body.data.revoked === true);
  check("a revoked key stops working immediately", (await call("GET", "/api/v1/integration/events", { token: svcKey })).status === 401);
  r = await call("POST", `/api/v1/admin/service-clients/${svcId}/revoke`, { token: tok.admin, json: {} });
  check("revoking twice is idempotent", r.status === 200 && r.body.data.revoked === false);
  check("a non-admin cannot revoke", (await call("POST", `/api/v1/admin/service-clients/${svcId}/revoke`, { token: tok.applicantB, json: {} })).status === 403);
  check("the audit log recorded the creation and revocation (without any key material)",
    Number(psql(`SELECT count(*) FROM audit_logs WHERE action IN ('service_client.created','service_client.revoked');`).trim()) >= 3
      && Number(psql(`SELECT count(*) FROM audit_logs WHERE new_state::text ~ 'nxsk_[A-Za-z0-9_-]{43}' OR reason ~ 'nxsk_[A-Za-z0-9_-]{43}';`).trim()) === 0);
  console.log("\n— Privacy-safe page and tap counts (merchant analytics) —");
  r = await call("GET", `/shop/${slug}`);
  check("the storefront marks Call, WhatsApp and Directions for counting", /data-track="call"/.test(r.text) && /data-track="directions"/.test(r.text));
  for (const action of ["view", "view", "call", "directions"]) await call("POST", `/api/v1/storefronts/${slug}/track`, { json: { action } });
  r = await call("POST", `/api/v1/storefronts/${slug}/track`, { json: { action: "whatsapp" } });
  check("anonymous visitors can record a tap", r.status === 200 && r.body.data.recorded === true);
  check("counts accumulate per action in the database",
    psql(`SELECT views || ',' || calls || ',' || whatsapp || ',' || directions FROM storefront_stats_daily WHERE storefront_id = (SELECT id FROM storefronts WHERE slug = '${slug}');`) === "2,1,1,1");
  r = await call("POST", `/api/v1/storefronts/${slug}/track`, { json: { action: "purchase" } });
  check("an unknown action is a validation error", r.status === 400 && r.body.error.code === "VALIDATION_FAILED");
  r = await call("POST", "/api/v1/storefronts/no-such-shop-zz/track", { json: { action: "view" } });
  const ghost = await call("POST", `/api/v1/storefronts/${slug}/track`, { json: { action: "view" } });
  check("an unknown slug answers exactly like a real one (no slug probing)", r.status === 200 && JSON.stringify(r.body.data) === JSON.stringify(ghost.body.data));
  check("the table holds only counts: no visitor columns", psql(`SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name = 'storefront_stats_daily';`) === "storefront_id,shop_id,day,views,calls,whatsapp,directions");
  r = await call("POST", `/api/v1/storefronts/${slug}/track`, { form: "action=view", headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  check("a non-JSON body is refused", r.status === 400);
  console.log("\n— Area waitlist (consent, privacy, staff follow-up) —");
  const wlLoc = psql(`SELECT id FROM localities WHERE slug = 'rotary-nagar'`);
  r = await call("GET", "/waitlist");
  check("the waitlist page renders with an explicit consent checkbox and a way to remove yourself", r.status === 200 && /Tell me when shops open near me/.test(r.text) && /name="consent_given"/.test(r.text) && /Remove my number/.test(r.text));
  r = await call("POST", "/api/v1/waitlist", { json: { locality_id: wlLoc, contact_phone: "+919811100001", consent_given: false } });
  check("joining without consent is refused", r.status === 400 && r.body.error.code === "VALIDATION_FAILED");
  r = await call("POST", "/api/v1/waitlist", { json: { locality_id: wlLoc, contact_phone: "98111", consent_given: true } });
  check("a malformed phone is refused", r.status === 400);
  r = await call("POST", "/api/v1/waitlist", { json: { locality_id: "00000000-0000-4000-8000-000000000000", contact_phone: "+919811100001", consent_given: true } });
  check("an unknown area is refused", r.status === 400);
  r = await call("POST", "/api/v1/waitlist", { json: { locality_id: wlLoc, contact_phone: "+919811100001", contact_name: "Ravi", consent_given: true } });
  check("an anonymous visitor can join with consent", r.status === 200 && r.body.data.status === "joined", JSON.stringify(r.body));
  r = await call("POST", "/api/v1/waitlist", { json: { locality_id: wlLoc, contact_phone: "+919811100001", consent_given: true } });
  check("joining twice is idempotent", r.status === 200 && r.body.data.status === "already_waiting" && psql(`SELECT count(*) FROM area_waitlist WHERE contact_phone = '+919811100001'`) === "1");
  r = await call("GET", "/api/v1/waitlist/demand");
  check("public demand hides small numbers (fewer than 3 waiting)", r.status === 200 && r.body.data.areas.length === 0 && r.body.data.minimum_shown === 3);
  for (const n of ["02", "03"]) await call("POST", "/api/v1/waitlist", { json: { locality_id: wlLoc, contact_phone: `+9198111000${n}`, consent_given: true } });
  r = await call("GET", "/api/v1/waitlist/demand");
  check("with three waiting, the area appears as an aggregate count with no names or numbers",
    r.body.data.areas.some((a) => a.locality_slug === "rotary-nagar" && a.waiting === 3) && !/\+91|Ravi/.test(r.text));
  r = await call("GET", "/sell");
  check("/sell shows the real demand and nothing invented", /3 people are waiting for shops in Rotary Nagar/.test(r.text));
  check("anonymous callers cannot read the waitlist", (await call("GET", "/api/v1/admin/waitlist")).status === 401);
  check("a customer cannot read the waitlist", (await call("GET", "/api/v1/admin/waitlist", { token: tok.applicantB })).status === 403);
  r = await call("GET", "/api/v1/admin/waitlist", { token: tok.admin });
  const wlRow = r.body?.data?.entries?.find((e) => e.contact_phone === "+919811100001");
  check("an admin sees entries with the consent timestamp", r.status === 200 && wlRow && wlRow.consented_at && wlRow.status === "waiting", JSON.stringify(r.body).slice(0, 200));
  r = await call("PATCH", `/api/v1/admin/waitlist/${wlRow.id}`, { token: tok.operator, json: { status: "contacted" } });
  check("an operator can mark someone contacted (audited)", r.status === 200 && r.body.data.changed === true && psql(`SELECT count(*) FROM audit_logs WHERE action = 'waitlist.contacted'`) === "1");
  r = await call("PATCH", `/api/v1/admin/waitlist/${wlRow.id}`, { token: tok.operator, json: { status: "contacted" } });
  check("marking again is idempotent", r.status === 200 && r.body.data.changed === false);
  check("a customer cannot change a status", (await call("PATCH", `/api/v1/admin/waitlist/${wlRow.id}`, { token: tok.applicantB, json: { status: "waiting" } })).status === 403);
  check("a bad status is a validation error", (await call("PATCH", `/api/v1/admin/waitlist/${wlRow.id}`, { token: tok.admin, json: { status: "deleted" } })).status === 400);
  r = await call("POST", "/api/v1/waitlist/leave", { json: { locality_id: wlLoc, contact_phone: "+919811100001" } });
  check("a person can withdraw: the entry and the phone number are deleted", r.status === 200 && psql(`SELECT count(*) FROM area_waitlist WHERE contact_phone = '+919811100001'`) === "0");
  r = await call("POST", "/api/v1/waitlist/leave", { json: { locality_id: wlLoc, contact_phone: "+919811100001" } });
  check("withdrawing is answered identically whether or not an entry existed", r.status === 200 && r.body.data.removed === true);
  r = await call("GET", "/search?q=zzqqxx-nothing&locality=rotary-nagar");
  check("an empty result offers the waitlist for that area", /href="\/waitlist\?locality=rotary-nagar"/.test(r.text) && /Tell me when shops open here/.test(r.text));

  console.log("\n— Language: Telugu / English —");
  r = await call("GET", "/");
  check("the default language is English with lang=en", /<html lang="en"/.test(r.text) && /Your neighbourhood/.test(r.text) && />English</.test(r.text) && />తెలుగు</.test(r.text));
  r = await call("GET", "/", { headers: { cookie: "nx_lang=te" } });
  check("a Telugu cookie renders Telugu chrome and hero with lang=te", /<html lang="te"/.test(r.text) && /మీ పరిసరాల దుకాణాలన్నీ ఒకే చోట/.test(r.text) && /సైన్ ఇన్/.test(r.text) && /దుకాణాలను చూడండి/.test(r.text));
  r = await call("GET", "/", { headers: { cookie: "nx_lang=fr" } });
  check("an unsupported language falls back to English", /<html lang="en"/.test(r.text));
  r = await call("GET", `/shop/${slug}`, { headers: { cookie: "nx_lang=te" } });
  check("the storefront buttons and verification badge are in Telugu, shop data is untouched", /కాల్/.test(r.text) && /NationX ద్వారా ధృవీకరించబడింది/.test(r.text) && /Sri Ram Kirana/.test(r.text));
  r = await call("GET", "/search?q=sri", { headers: { cookie: "nx_lang=te; nx_near=17.247,80.151" } });
  check("search in Telugu keeps working, with Telugu location controls and distances", r.status === 200 && /లొకేషన్/.test(r.text) && /Sri Ram Kirana/.test(r.text));
  r = await call("GET", "/waitlist", { headers: { cookie: "nx_lang=te" } });
  check("the waitlist page is fully Telugu", /నా దగ్గర దుకాణాలు తెరిచినప్పుడు చెప్పండి/.test(r.text) && /ఈ ప్రాంతంలో దుకాణాలు తెరిచినప్పుడు NationX/.test(r.text));
  check("the language cookie holds no personal data and the site sets none by itself on a plain visit", !/set-cookie:[^\n]*nx_lang/i.test([...(await call("GET", "/")).headers].map((h) => h.join(": ")).join("\n")));
  console.log("\n— Installable app (PWA) and /app —");
  r = await call("GET", "/manifest.webmanifest");
  check("the web app manifest makes the site installable (standalone, name, 192/512/maskable icons)",
    r.status === 200 && r.body.display === "standalone" && r.body.short_name === "NationX" && r.body.start_url.startsWith("/") && ["192x192", "512x512"].every((s) => r.body.icons.some((i) => i.sizes === s)) && r.body.icons.some((i) => i.purpose === "maskable"), JSON.stringify(r.body).slice(0, 200));
  for (const icon of ["/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png", "/icons/apple-touch-icon.png"]) {
    const res = await fetch(`${APP}${icon}`);
    check(`${icon} is served as an image`, res.status === 200 && /image\/png/.test(res.headers.get("content-type") ?? "") && (await res.arrayBuffer()).byteLength > 500);
  }
  const sw = await fetch(`${APP}/sw.js`);
  const swText = await sw.text();
  check("the service worker is served, never caches pages or the API, and has an offline page", sw.status === 200 && /javascript/.test(sw.headers.get("content-type") ?? "") && /req\.mode === "navigate"/.test(swText) && !/\/api\//.test(swText.replace(/\/\*[\s\S]*?\*\//g, "")));
  r = await call("GET", "/offline.html");
  check("the offline page exists", r.status === 200 && /No internet right now/.test(r.text));
  r = await call("GET", "/");
  check("the home page links the manifest and apple icon, and registers the worker script", /rel="manifest"/.test(r.text) && /apple-touch-icon/.test(r.text) && /href="\/app"/.test(r.text));
  r = await call("GET", "/app");
  check("/app offers install, a QR code and clear no-store wording", r.status === 200 && /Get the NationX app/.test(r.text) && /<svg[^>]*viewBox/.test(r.text) && /No app store needed/.test(r.text) && /Opens full-screen/.test(r.text) && !/play\.google|apps\.apple|\.apk/i.test(r.text));
  r = await call("GET", "/app", { headers: { cookie: "nx_lang=te" } });
  check("/app is available in Telugu", /NationX యాప్ పొందండి/.test(r.text));
  check("admin curation pages are not public", (await call("GET", "/admin/homepage")).status !== 200 && (await call("GET", "/admin/taxonomy")).status !== 200);
  psql(`INSERT INTO homepage_banners (title, body, link_url) VALUES ('Integration banner', 'Hello', '/explore'); INSERT INTO featured_storefronts (storefront_id) SELECT id FROM storefronts WHERE slug = '${slug}';`);
  r = await call("GET", "/");
  check("an admin-set banner and featured shop appear on the homepage with no redeploy", /Integration banner/.test(r.text) && /Featured stores/.test(r.text));
  psql(`UPDATE homepage_banners SET is_active = false; DELETE FROM featured_storefronts;`);
  r = await call("GET", "/");
  check("with nothing configured the homepage shows neither (no fake featured shops)", !/Integration banner/.test(r.text) && !/Featured stores/.test(r.text));
  console.log("\n— Unpublished businesses disappear everywhere —");
  psql(`UPDATE storefronts SET visibility_status = 'hidden' WHERE slug = '${slug}';`);
  check("hidden storefront page is a real 404", (await call("GET", `/shop/${slug}`)).status === 404);
  r = await call("GET", "/search?q=sri+ram");
  check("hidden storefront is gone from search", !/Sri Ram Kirana/.test(r.text));
  r = await call("GET", "/category/kirana");
  check("...and from the category page", !/Sri Ram Kirana/.test(r.text));
  check("...and from the public API", (await call("GET", `/api/v1/storefronts/${slug}`)).status === 404);
  psql(`UPDATE storefronts SET visibility_status = 'visible', is_published = false WHERE slug = '${slug}';`);
  check("an unpublished storefront is a 404 too", (await call("GET", `/shop/${slug}`)).status === 404);
  psql(`UPDATE storefronts SET is_published = true WHERE slug = '${slug}';`);
  check("republishing brings it back", (await call("GET", `/shop/${slug}`)).status === 200);

  console.log("\n— Rejected / pending applications never appear —");
  r = await call("POST", "/api/v1/merchant/applications", { token: tok.applicantB, json: application("Rejected Mart", "+919848099001", { locality_id: wyra }) });
  const appB = r.body.data.application_id;
  r = await call("POST", `/api/v1/admin/applications/${appB}/reject`, { token: tok.admin, json: { reason: "Unable to verify establishment" } });
  check("admin rejects with a reason", r.status === 200);
  r = await call("GET", "/search?q=rejected+mart");
  check("a rejected business is not discoverable", /No stores found/.test(r.text));

  console.log("\n— Product catalogue: ownership, validation, visibility —");
  const shopA = psql(`SELECT id FROM shops WHERE name = 'Sri Ram Kirana'`).trim();
  psql(`INSERT INTO business_members (business_id, user_id, role) SELECT business_id, '${uid.customer2}', 'employee' FROM shops WHERE id = '${shopA}';`);
  const P = `/api/v1/merchant/shops/${shopA}/products`;
  r = await call("POST", P, { token: tok.applicantA, json: { name: "Basmati Rice", name_te: "బాస్మతి బియ్యం", price: 120, mrp: 130, unit: "kg", stock_status: "in_stock", shop_id: randomUUID() } });
  check("owner adds an item (201); a client-supplied shop id is ignored", r.status === 201 && r.body.data.product_id, JSON.stringify(r.body));
  const prodRice = r.body.data.product_id;
  r = await call("POST", P, { token: tok.applicantA, json: { name: "Tata Salt" } });
  check("an item with no price/stock is accepted (201)", r.status === 201);
  const prodSalt = r.body.data.product_id;
  for (const [label, bad] of [["negative price", { price: -1 }], ["MRP below price", { price: 50, mrp: 40 }], ["blank name", { name: "  " }], ["bad stock status", { stock_status: "plenty" }], ["three decimals", { price: 1.234 }]]) {
    r = await call("POST", P, { token: tok.applicantA, json: { name: "Bad item", ...bad } });
    check(`invalid item rejected: ${label}`, r.status === 400 && r.body.error.code === "VALIDATION_FAILED");
  }
  r = await call("GET", P, { token: tok.applicantA });
  const rice = r.body.data.products.find((x) => x.id === prodRice);
  const salt = r.body.data.products.find((x) => x.id === prodSalt);
  check("owner lists both items; fresh stock is 'in_stock', unknown stays 'call_to_confirm' with no price invented",
    r.status === 200 && rice?.effective_stock_status === "in_stock" && salt?.effective_stock_status === "call_to_confirm" && salt.price === null && salt.stock_confirmed_at === null);
  check("anonymous cannot use the merchant item API (401)", (await call("GET", P)).status === 401);
  for (const [who, token] of [["another merchant", tok.applicantB], ["a customer", tok.customer1]]) {
    check(`${who} cannot list another shop's items (404)`, (await call("GET", P, { token })).status === 404);
    check(`${who} cannot add an item to it (404)`, (await call("POST", P, { token, json: { name: "Intruder" } })).status === 404);
    check(`${who} cannot edit its items (404)`, (await call("PATCH", `${P}/${prodRice}`, { token, json: { price: 1 } })).status === 404);
    check(`${who} cannot delete its items (404)`, (await call("DELETE", `${P}/${prodRice}`, { token })).status === 404);
  }
  check("an employee can view the items (200)", (await call("GET", P, { token: tok.customer2 })).status === 200);
  check("an employee cannot add (403)", (await call("POST", P, { token: tok.customer2, json: { name: "Staff item" } })).status === 403);
  check("an employee cannot edit (403)", (await call("PATCH", `${P}/${prodRice}`, { token: tok.customer2, json: { price: 1 } })).status === 403);
  check("an employee cannot delete (403)", (await call("DELETE", `${P}/${prodRice}`, { token: tok.customer2 })).status === 403);
  check("nothing changed after the refused attempts",
    psql(`SELECT price FROM storefront_products WHERE id = '${prodRice}'`).trim() === "120.00" && Number(psql(`SELECT count(*) FROM storefront_products WHERE shop_id = '${shopA}'`)) === 2);
  r = await call("PATCH", `${P}/${prodRice}`, { token: tok.applicantA, json: {} });
  check("an empty update is rejected (400)", r.status === 400);
  r = await call("PATCH", `${P}/${randomUUID()}`, { token: tok.applicantA, json: { price: 5 } });
  check("editing an unknown item is 404", r.status === 404);

  console.log("\n— Product catalogue: public showcase and availability labels —");
  r = await call("GET", `/shop/${slug}`);
  check("storefront shows the real items with price and a fresh 'In stock' label",
    r.status === 200 && /Basmati Rice/.test(r.text) && /బాస్మతి బియ్యం/.test(r.text) && /₹120\.00/.test(r.text) && /In stock/.test(r.text));
  check("an item with unknown price/stock shows 'Call for price' and 'Call to confirm' (nothing invented)",
    /Tata Salt/.test(r.text) && /Call for price/.test(r.text) && /Call to confirm/.test(r.text));
  check("storefront still offers no ordering or cart", !/Add to cart/i.test(r.text) && !/Buy now/i.test(r.text) && !/Checkout/i.test(r.text));
  r = await call("GET", `/api/v1/storefronts/${slug}`);
  check("public storefront API includes the items with effective stock labels",
    r.status === 200 && r.body.data.products.length === 2 && r.body.data.products.find((p) => p.name === "Basmati Rice").effective_stock_status === "in_stock");
  check("public storefront API carries the shop's category details and subcategory fields (empty/null when none were given)",
    r.status === 200 && typeof r.body.data.shop.category_details === "object" && Object.keys(r.body.data.shop.category_details).length === 0 && r.body.data.shop.subcategory === null, JSON.stringify({ d: r.body.data.shop?.category_details, s: r.body.data.shop?.subcategory }));
  r = await call("PATCH", `${P}/${prodSalt}`, { token: tok.applicantA, json: { is_published: false } });
  check("owner unpublishes an item (200)", r.status === 200);
  r = await call("GET", `/shop/${slug}`);
  check("an unpublished item leaves the public page", !/Tata Salt/.test(r.text) && /Basmati Rice/.test(r.text));
  r = await call("GET", `/api/v1/storefronts/${slug}`);
  check("...and the public API (the owner's own unpublished items are not leaked through the public route)", r.body.data.products.length === 1);
  psql(`UPDATE storefront_products SET stock_confirmed_at = now() - interval '5 days' WHERE id = '${prodRice}';`);
  r = await call("GET", `/shop/${slug}`);
  check("stale stock confirmation downgrades 'In stock' to 'Call to confirm' on the page", /Basmati Rice/.test(r.text) && !/In stock/.test(r.text) && /Call to confirm/.test(r.text));
  r = await call("GET", P, { token: tok.applicantA });
  const stale = r.body.data.products.find((x) => x.id === prodRice);
  check("the merchant still sees what they recorded (stock_status) next to the effective label", stale.stock_status === "in_stock" && stale.effective_stock_status === "call_to_confirm");
  check("an employee cannot re-confirm stock (403)", (await call("PATCH", `${P}/${prodRice}`, { token: tok.customer2, json: { confirm_stock: true } })).status === 403);
  check("another merchant cannot re-confirm stock (404)", (await call("PATCH", `${P}/${prodRice}`, { token: tok.applicantB, json: { confirm_stock: true } })).status === 404);
  r = await call("PATCH", `${P}/${prodRice}`, { token: tok.applicantA, json: { confirm_stock: true } });
  check("owner re-confirms stock; the database stamps a fresh time", r.status === 200 && psql(`SELECT stock_confirmed_at > now() - interval '1 minute' FROM storefront_products WHERE id = '${prodRice}'`).trim() === "t");
  check("...and the page shows 'In stock' again", /In stock/.test((await call("GET", `/shop/${slug}`)).text));

  console.log("\n— Product catalogue: search —");
  r = await call("GET", "/search?q=basmati");
  check("search shows an 'Items' section with the item, price, label and selling shop",
    r.status === 200 && /Items for/.test(r.text) && /Basmati Rice/.test(r.text) && /₹120\.00/.test(r.text) && /Sri Ram Kirana/.test(r.text));
  r = await call("GET", "/search?q=బాస్మతి");
  check("a Telugu item name finds the item and the shop", /Basmati Rice/.test(r.text) && /Sri Ram Kirana/.test(r.text));
  r = await call("GET", "/search?q=basmat+rice");
  check("a misspelled item name still finds it", /Basmati Rice/.test(r.text));
  r = await call("GET", "/search?q=tata+salt");
  check("an unpublished item is not searchable", !/Tata Salt/.test(r.text) && /No stores found/.test(r.text));
  r = await call("GET", "/search?q=kirana");
  check("a query matching no item shows no Items section", !/Items for/.test(r.text));
  r = await call("GET", "/api/v1/discovery/products?q=basmati");
  check("API item search returns real items with the effective label", r.status === 200 && r.body.data.total === 1 && r.body.data.results[0].type === "product" && r.body.data.results[0].effective_stock_status === "in_stock" && !("total_count" in r.body.data.results[0]));
  check("API item search requires a query (400)", (await call("GET", "/api/v1/discovery/products")).status === 400);
  r = await call("GET", "/api/v1/discovery/products?q=%25");
  check("a wildcard-only query is literal text, not 'everything'", r.status === 200 && r.body.data.total === 0);
  r = await call("GET", "/api/v1/discovery/products?q=basmati&limit=500");
  check("API item search rejects an oversized page", r.status === 400);

  console.log("\n— Administrator oversight: hide / suspend / reactivate —");
  const sfId = psql(`SELECT id FROM storefronts WHERE slug = '${slug}'`).trim();
  const V = `/api/v1/admin/storefronts/${sfId}/visibility`;
  check("anonymous cannot list storefronts for oversight (401)", (await call("GET", "/api/v1/admin/storefronts")).status === 401);
  check("a shop owner cannot list storefronts for oversight (403)", (await call("GET", "/api/v1/admin/storefronts", { token: tok.applicantA })).status === 403);
  r = await call("GET", "/api/v1/admin/storefronts?q=sri+ram", { token: tok.admin });
  check("admin finds a storefront by shop name", r.status === 200 && r.body.data.total === 1 && r.body.data.storefronts[0].slug === slug && r.body.data.storefronts[0].shop.name === "Sri Ram Kirana", JSON.stringify(r.body).slice(0, 300));
  r = await call("GET", "/api/v1/admin/storefronts?status=suspended", { token: tok.admin });
  check("admin filters by moderation status", r.status === 200 && r.body.data.total === 0);
  r = await call("GET", "/api/v1/admin/storefronts?q=%25%2C()", { token: tok.admin });
  check("filter-syntax characters in the search are neutralised (no error)", r.status === 200);
  check("anonymous cannot moderate (401)", (await call("POST", V, { json: { status: "suspended", reason: "test reason" } })).status === 401);
  check("a customer cannot moderate (403)", (await call("POST", V, { token: tok.customer1, json: { status: "suspended", reason: "test reason" } })).status === 403);
  check("the shop owner cannot moderate their own page (403)", (await call("POST", V, { token: tok.applicantA, json: { status: "suspended", reason: "test reason" } })).status === 403);
  check("an operator cannot moderate (403, admin only)", (await call("POST", V, { token: tok.operator, json: { status: "suspended", reason: "test reason" } })).status === 403);
  r = await call("POST", V, { token: tok.admin, json: { status: "suspended" } });
  check("suspending without a reason is rejected (400)", r.status === 400);
  r = await call("POST", V, { token: tok.admin, json: { status: "banned", reason: "whatever" } });
  check("an unknown status is rejected (400)", r.status === 400);
  check("nothing changed after the refusals", psql(`SELECT visibility_status FROM storefronts WHERE id = '${sfId}'`).trim() === "visible");
  r = await call("POST", `/api/v1/admin/storefronts/${randomUUID()}/visibility`, { token: tok.admin, json: { status: "hidden", reason: "no such page" } });
  check("an unknown storefront is 404", r.status === 404);
  r = await call("POST", V, { token: tok.admin, json: { status: "suspended", reason: "Complaint under review" } });
  check("admin suspends with a reason (200)", r.status === 200 && r.body.data.changed === true && r.body.data.status === "suspended", JSON.stringify(r.body));
  r = await call("GET", "/api/v1/admin/storefronts?status=suspended", { token: tok.admin });
  check("the oversight list now shows it as suspended with the reason", r.body.data.total === 1 && r.body.data.storefronts[0].visibility_reason === "Complaint under review");
  check("the suspended storefront is a real 404", (await call("GET", `/shop/${slug}`)).status === 404);
  check("...gone from the public API", (await call("GET", `/api/v1/storefronts/${slug}`)).status === 404);
  r = await call("GET", "/search?q=basmati");
  check("...and neither the shop nor its items are searchable", !/Sri Ram Kirana/.test(r.text) && !/Basmati Rice/.test(r.text));
  r = await call("GET", "/api/v1/discovery/products?q=basmati");
  check("...nor in the item API", r.body.data.total === 0);
  r = await call("POST", V, { token: tok.admin, json: { status: "suspended", reason: "Complaint under review" } });
  check("repeating the suspension is idempotent", r.status === 200 && r.body.data.changed === false);
  check("the suspension is audited once, with actor and reason",
    Number(psql(`SELECT count(*) FROM audit_logs WHERE action = 'storefront.suspended' AND entity_id = '${sfId}' AND reason = 'Complaint under review' AND actor_id = '${uid.admin}'`)) === 1);
  r = await call("POST", V, { token: tok.admin, json: { status: "visible" } });
  check("admin reactivates without a reason (200)", r.status === 200 && r.body.data.status === "visible");
  check("the storefront is public again, items included", (await call("GET", `/shop/${slug}`)).status === 200 && /Basmati Rice/.test((await call("GET", "/search?q=basmati")).text));
  check("reactivation clears the stored reason", psql(`SELECT visibility_reason IS NULL FROM storefronts WHERE id = '${sfId}'`).trim() === "t");

  console.log("\n— Product catalogue: removal and page access —");
  r = await call("DELETE", `${P}/${prodRice}`, { token: tok.applicantA });
  check("owner deletes an item (200)", r.status === 200);
  check("a deleted item is gone from the page and from search", !/Basmati Rice/.test((await call("GET", `/shop/${slug}`)).text) && (await call("GET", "/api/v1/discovery/products?q=basmati")).body.data.total === 0);
  r = await call("DELETE", `${P}/${prodRice}`, { token: tok.applicantA });
  check("deleting it again is 404", r.status === 404);
  for (const p of [`/merchant/shops/${shopA}/products`, `/merchant/shops/${shopA}/products/${prodRice}`, "/admin/storefronts"]) {
    r = await call("GET", p);
    check(`anonymous is redirected from ${p.replace(shopA, ":shop").replace(prodRice, ":item")}`, r.status === 307 && /sign-in/.test(r.location ?? ""));
  }

  console.log("\n— Mobile app endpoints: my shops, shop edit, item photos —");
  r = await call("GET", "/api/v1/merchant/shops");
  check("anonymous cannot list shops (401)", r.status === 401);
  r = await call("GET", "/api/v1/merchant/shops", { token: tok.applicantA });
  const mine = r.body?.data?.businesses?.[0];
  check("the owner's shop list shows their shop, role and storefront",
    r.status === 200 && r.body.data.businesses.length === 1 && mine.role === "owner" && mine.business.shops[0].name === "Sri Ram Kirana" && mine.business.shops[0].storefront.slug === slug, JSON.stringify(r.body).slice(0, 200));
  r = await call("GET", "/api/v1/merchant/shops", { token: tok.applicantB });
  check("another merchant's list does not contain this shop", r.status === 200 && !JSON.stringify(r.body).includes("Sri Ram Kirana"));
  r = await call("GET", "/api/v1/merchant/shops", { token: tok.customer2 });
  check("an employee sees the shop with the employee role", r.body.data.businesses[0]?.role === "employee");
  const S = `/api/v1/merchant/shops/${shopA}`;
  check("owner reads a single shop (200)", (await call("GET", S, { token: tok.applicantA })).status === 200);
  check("a non-member gets 404 for a single shop", (await call("GET", S, { token: tok.applicantB })).status === 404);
  r = await call("PATCH", S, { token: tok.applicantA, json: { headline: "Fresh stock every morning", phone: "+919848011999", operating_hours: { opens: "07:30", closes: "22:00", closed_days: ["sunday"] } } });
  check("owner edits permitted shop details (200)", r.status === 200, JSON.stringify(r.body));
  r = await call("GET", `/shop/${slug}`);
  check("the public page shows the edit immediately", /Fresh stock every morning/.test(r.text) && /tel:\+919848011999/.test(r.text) && /7:30 AM/.test(r.text));
  check("an invalid phone is rejected (400)", (await call("PATCH", S, { token: tok.applicantA, json: { phone: "12345" } })).status === 400);
  r = await call("PATCH", S, { token: tok.applicantA, json: { name: "Hacked Name", slug: "stolen", is_published: false } });
  check("name, slug and publication cannot be changed by the merchant (nothing to update → 400)", r.status === 400);
  check("...and the shop is unchanged", psql(`SELECT name FROM shops WHERE id = '${shopA}'`).trim() === "Sri Ram Kirana" && (await call("GET", `/shop/${slug}`)).status === 200);
  check("another merchant cannot edit the shop (404)", (await call("PATCH", S, { token: tok.applicantB, json: { headline: "x" } })).status === 404);
  check("an employee cannot edit the shop (403)", (await call("PATCH", S, { token: tok.customer2, json: { headline: "x" } })).status === 403);
  check("anonymous cannot edit the shop (401)", (await call("PATCH", S, { json: { headline: "x" } })).status === 401);

  const IMG = `${S}/products/${prodSalt}/image`;
  const upload = (token, blob, name = "photo.png") => { const f = new FormData(); if (blob) f.append("file", blob, name); return call("POST", IMG, { token, form: f }); };
  const png = () => new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], { type: "image/png" });
  check("anonymous cannot upload an item photo (401)", (await upload(undefined, png())).status === 401);
  check("another merchant cannot upload (404)", (await upload(tok.applicantB, png())).status === 404);
  check("an employee cannot upload (403)", (await upload(tok.customer2, png())).status === 403);
  check("a request without a file is rejected (400)", (await upload(tok.applicantA, null)).status === 400);
  r = await upload(tok.applicantA, new Blob([new Uint8Array(5 * 1024 * 1024 + 10)], { type: "image/png" }));
  check("an oversized photo is rejected (400)", r.status === 400 && /too large/i.test(r.body.error.message));
  r = await upload(tok.applicantA, new Blob(["MZ this is an executable pretending to be a picture"], { type: "image/png" }), "evil.png");
  check("a non-image renamed to .png is refused by content, not by name (400)", r.status === 400 && /JPEG, PNG or WebP/.test(r.body.error.message), JSON.stringify(r.body));
  r = await call("POST", `${S}/products/${randomUUID()}/image`, { token: tok.applicantA, form: (() => { const f = new FormData(); f.append("file", png(), "p.png"); return f; })() });
  check("uploading to an unknown item is 404", r.status === 404);
  check("removing a photo needs ownership (404 for others, 403 for staff)",
    (await call("DELETE", IMG, { token: tok.applicantB })).status === 404 && (await call("DELETE", IMG, { token: tok.customer2 })).status === 403);
  check("owner removes a photo (200)", (await call("DELETE", IMG, { token: tok.applicantA })).status === 200);
  console.log("\n— Help Me Find It: submission and validation —");
  const hmf = (extra = {}) => ({
    item_name: "Wood-pressed sesame oil 5L", item_description: "Ganuga oil", preferred_locality_id: gandhi, category_id: cat,
    contact_name: "Venkatesh", contact_phone: "+919848012345", consent_given: true, ...extra,
  });
  r = await call("POST", "/api/v1/help-me-find-it", { json: hmf() });
  check("anonymous visitor submits a request (201) and gets a tracking ID", r.status === 201 && /^HMF-KHM-\d{6}-\d{4}$/.test(r.body.data.tracking_id), JSON.stringify(r.body));
  const trackingAnon = r.body.data.tracking_id;
  for (const [label, bad] of [
    ["missing consent", { consent_given: false }], ["too-short item", { item_name: "x" }], ["bad phone", { contact_phone: "123" }],
    ["bad email", { contact_email: "nope" }], ["bad locality id", { preferred_locality_id: "abc" }], ["empty name", { contact_name: " " }],
  ]) {
    r = await call("POST", "/api/v1/help-me-find-it", { json: hmf(bad) });
    check(`invalid request rejected: ${label}`, r.status === 400 && r.body.error.code === "VALIDATION_FAILED");
  }
  r = await call("POST", "/api/v1/help-me-find-it", { json: hmf({ preferred_locality_id: randomUUID() }) });
  check("unknown locality rejected by the database", r.status === 400);
  r = await call("POST", "/api/v1/help-me-find-it", { headers: { "Content-Type": "application/json" }, json: undefined });
  check("empty body rejected", r.status === 400);

  console.log("\n— Help Me Find It: ownership and permissions —");
  r = await call("POST", "/api/v1/help-me-find-it", { token: tok.customer1, json: hmf({ item_name: "Brass pooja lamp", contact_phone: "+919848099999" }) });
  check("signed-in customer submits (201)", r.status === 201);
  const trackingC1 = r.body.data.tracking_id;
  r = await call("GET", "/api/v1/help-me-find-it", { token: tok.customer1 });
  check("customer sees exactly their own request", r.status === 200 && r.body.data.requests.length === 1 && r.body.data.requests[0].tracking_id === trackingC1);
  const reqC1 = r.body.data.requests[0].id;
  r = await call("GET", "/api/v1/help-me-find-it", { token: tok.customer2 });
  check("another customer sees none of it", r.status === 200 && r.body.data.requests.length === 0);
  check("anonymous cannot list requests (401)", (await call("GET", "/api/v1/help-me-find-it")).status === 401);
  r = await call("POST", `/api/v1/help-me-find-it/${reqC1}/cancel`, { token: tok.customer2 });
  check("another customer cannot cancel it (404)", r.status === 404);
  check("anonymous cannot cancel it (401)", (await call("POST", `/api/v1/help-me-find-it/${reqC1}/cancel`)).status === 401);
  check("a customer cannot reach the staff queue (403)", (await call("GET", "/api/v1/admin/help-requests", { token: tok.customer1 })).status === 403);
  check("anonymous cannot reach the staff queue (401)", (await call("GET", "/api/v1/admin/help-requests")).status === 401);
  check("a merchant-applicant cannot reach the staff queue (403)", (await call("GET", "/api/v1/admin/help-requests", { token: tok.applicantA })).status === 403);
  check("a customer cannot update a request (403)", (await call("PATCH", `/api/v1/admin/help-requests/${reqC1}`, { token: tok.customer1, json: { status: "matched" } })).status === 403);

  console.log("\n— Help Me Find It: tracking without an account —");
  r = await call("POST", "/api/v1/help-me-find-it/track", { json: { tracking_id: trackingAnon.toLowerCase(), contact_phone: "+919848012345" } });
  check("tracking works with the right ID + phone", r.status === 200 && r.body.data.status === "pending" && !("contact_phone" in r.body.data));
  r = await call("POST", "/api/v1/help-me-find-it/track", { json: { tracking_id: trackingAnon, contact_phone: "+919800000000" } });
  check("wrong phone → 404 (no hint which part was wrong)", r.status === 404);
  r = await call("POST", "/api/v1/help-me-find-it/track", { json: { tracking_id: "HMF-KHM-209901-0001", contact_phone: "+919848012345" } });
  check("unknown ID → the same 404", r.status === 404);

  console.log("\n— Help Me Find It: staff handling —");
  r = await call("GET", "/api/v1/admin/help-requests?status=pending", { token: tok.operator });
  check("operator sees the pending queue with contact details", r.status === 200 && r.body.data.requests.length === 2 && r.body.data.requests.every((x) => x.contact_phone));
  const reqAnon = r.body.data.requests.find((x) => x.tracking_id === trackingAnon).id;
  r = await call("PATCH", `/api/v1/admin/help-requests/${reqAnon}`, { token: tok.operator, json: { status: "matched", matched_shop_slug: "no-such-shop" } });
  check("'matched' needs a real published shop", r.status === 400);
  r = await call("PATCH", `/api/v1/admin/help-requests/${reqAnon}`, { token: tok.operator, json: { status: "unresolved" } });
  check("'unresolved' needs a note", r.status === 400);
  r = await call("PATCH", `/api/v1/admin/help-requests/${reqAnon}`, { token: tok.operator, json: { status: "auto_matched" } });
  check("no invented statuses (no automatic matching)", r.status === 400);
  r = await call("PATCH", `/api/v1/admin/help-requests/${reqAnon}`, { token: tok.operator, json: { status: "matched", notes: "Shop confirmed stock", matched_shop_slug: slug } });
  check("operator matches it to a published shop", r.status === 200);
  r = await call("POST", "/api/v1/help-me-find-it/track", { json: { tracking_id: trackingAnon, contact_phone: "+919848012345" } });
  check("requester sees the confirmed shop only after staff confirm", r.body.data.status === "matched" && r.body.data.matched_shop_slug === slug);
  r = await call("POST", `/api/v1/help-me-find-it/${reqC1}/cancel`, { token: tok.customer1 });
  check("owner cancels their own open request", r.status === 200);
  r = await call("POST", `/api/v1/help-me-find-it/${reqC1}/cancel`, { token: tok.customer1 });
  check("cancelling twice is refused (409)", r.status === 409);
  check("audit trail exists for staff and customer actions",
    Number(psql(`SELECT count(*) FROM audit_logs WHERE entity_type = 'help_me_find_it_request'`)) >= 2);

  console.log("\n— Abuse protection —");
  const results = [];
  for (let i = 0; i < 6; i++) results.push((await call("POST", "/api/v1/help-me-find-it", { json: hmf({ item_name: `Spam item ${i}`, contact_phone: "+919848000777" }) })).status);
  check("the 6th request from one phone within an hour is throttled (429)", results.slice(0, 5).every((s) => s === 201) && results[5] === 429, results.join(","));

  console.log("\n— Pages and access control —");
  r = await call("GET", "/help-me-find-it?item=brass+lamp&locality=gandhi-chowk");
  check("Help me find it page renders, prefilled from a failed search", r.status === 200 && /brass lamp/.test(r.text) && /name="consent_given"/.test(r.text) && /name="website"/.test(r.text));
  check("tracking page renders", (await call("GET", "/help-me-find-it/track")).status === 200);
  for (const p of ["/account/requests", "/admin/help-requests", `/admin/help-requests/${reqC1}`, "/admin/applications", "/merchant"]) {
    r = await call("GET", p);
    check(`anonymous is redirected from ${p.replace(reqC1, ":id")}`, r.status === 307 && /sign-in/.test(r.location ?? ""));
  }
  r = await call("GET", "/sign-in");
  check("sign-in page renders", r.status === 200 && /name="password"/.test(r.text));
  console.log("\n— Security headers, health check and rate limiting —");
  const gatewayOrigin = `http://127.0.0.1:${GATEWAY_PORT}`;
  for (const p of ["/", "/search", `/shop/${slug}`, "/api/v1/taxonomy", "/sign-in"]) {
    const h = (await call("GET", p)).headers;
    const csp = h.get("content-security-policy") ?? "";
    check(`${p} sends the security headers`,
      h.get("x-content-type-options") === "nosniff" && h.get("x-frame-options") === "DENY" && /strict-origin/.test(h.get("referrer-policy") ?? "") && /max-age=\d+/.test(h.get("strict-transport-security") ?? "") && /camera=\(\)/.test(h.get("permissions-policy") ?? "") && h.get("x-powered-by") === null,
      [...h.keys()].join(","));
    check(`${p} CSP forbids framing, plugins and foreign hosts, and allows only this site + the configured Supabase origin`,
      /frame-ancestors 'none'/.test(csp) && /object-src 'none'/.test(csp) && /base-uri 'self'/.test(csp) && csp.includes(`connect-src 'self' ${gatewayOrigin}`) && !/unsafe-eval/.test(csp) && !/\*/.test(csp), csp);
  }
  r = await call("GET", "/api/health");
  check("liveness endpoint answers ok", r.status === 200 && r.body.status === "ok" && !("database" in r.body));
  r = await call("GET", "/api/health?deep=1");
  check("deep health check reaches the database", r.status === 200 && r.body.database === "ok", JSON.stringify(r.body));
  await startApp({ ...appEnv, API_RATE_LIMIT_READ: "5", API_RATE_LIMIT_WRITE: "3", API_RATE_LIMIT_SENSITIVE: "2", NODE_ENV: "production" }, 3198, true);
  const lim = async (method, p, ip, json) => (await fetch(`http://127.0.0.1:3198${p}`, { method, headers: { "x-forwarded-for": ip, ...(json ? { "content-type": "application/json" } : {}) }, body: json ? JSON.stringify(json) : undefined }));
  const reads = []; for (let i = 0; i < 7; i++) reads.push((await lim("GET", "/api/v1/taxonomy", "203.0.113.10")).status);
  check("the 6th read from one address in a window is refused with 429", reads.slice(0, 5).every((s) => s === 200) && reads[5] === 429 && reads[6] === 429, reads.join(","));
  const refused = await lim("GET", "/api/v1/taxonomy", "203.0.113.10");
  const rb = await refused.json();
  check("the refusal uses the standard error envelope with Retry-After", rb.success === false && rb.error.code === "RATE_LIMITED" && Number(refused.headers.get("retry-after")) >= 1);
  check("another address is unaffected", (await lim("GET", "/api/v1/taxonomy", "203.0.113.11")).status === 200);
  const sens = []; for (let i = 0; i < 3; i++) sens.push((await lim("POST", "/api/v1/help-me-find-it/track", "203.0.113.12", { tracking_id: "HMF-KHM-209901-0001", contact_phone: "+919848012345" })).status);
  check("anonymous request-lookup is limited far tighter (3rd attempt refused)", sens[0] !== 429 && sens[1] !== 429 && sens[2] === 429, sens.join(","));
  check("pages are not rate limited by the API limiter", (await lim("GET", "/", "203.0.113.10")).status === 200);
  console.log("\n— Notifications: queue, scheduler endpoint, provider webhooks —");
  {
    const NOTIFY_PORT = 3197, FAKE_PORT = 3190, CRON = "integration-cron-secret-0123456789";
    const received = [];
    let smsMode = "ok";
    const fake = http.createServer(async (req, res) => {
      const chunks = []; for await (const ch of req) chunks.push(ch);
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      received.push({ path: req.url, auth: req.headers.authorization ?? null, idem: req.headers["idempotency-key"] ?? null, body });
      if (req.url === "/sms" && smsMode !== "ok") { res.writeHead(Number(smsMode)).end("gateway says no"); return; }
      res.writeHead(202).end("{}");
    });
    await new Promise((r) => fake.listen(FAKE_PORT, "127.0.0.1", r));
    const notifyProc = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "start", "-p", String(NOTIFY_PORT)], {
      cwd: root, stdio: "ignore",
      env: { ...appEnv, NODE_ENV: "production", CRON_SECRET: CRON,
        EMAIL_PROVIDER: "webhook", EMAIL_WEBHOOK_URL: `http://127.0.0.1:${FAKE_PORT}/email`, EMAIL_WEBHOOK_TOKEN: "emailtok",
        SMS_PROVIDER: "webhook", SMS_WEBHOOK_URL: `http://127.0.0.1:${FAKE_PORT}/sms` },
    });
    try {
      for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${NOTIFY_PORT}/api/health`); break; } catch { await sleep(500); } }
      const dispatch = async (secret, method = "POST") => {
        const res = await fetch(`http://127.0.0.1:${NOTIFY_PORT}/api/v1/internal/notifications/dispatch`, { method, headers: secret ? { authorization: `Bearer ${secret}` } : {} });
        return { status: res.status, www: res.headers.get("www-authenticate"), text: await res.text() };
      };
      const drain = async () => {
        const total = { claimed: 0, sent: 0, retried: 0, failed: 0 };
        for (let i = 0; i < 6; i++) {
          const d = JSON.parse((await dispatch(CRON)).text).data;
          for (const k of Object.keys(total)) total[k] += d[k];
          if (d.claimed === 0) break;
        }
        return total;
      };

      check("approving the application queued one e-mail and one SMS for the applicant (same transaction)",
        psql(`SELECT count(*) FROM notification_queue WHERE template = 'application_approved' AND entity_id = '${appA}'`) === "2");
      check("nothing is sent by the approval itself: the rows wait for the scheduler", received.length === 0);

      r = await call("POST", "/api/v1/internal/notifications/dispatch");
      check("without CRON_SECRET configured the scheduler endpoint is closed (503), not open", r.status === 503, String(r.status));

      let d = await dispatch(tok.admin);
      check("a signed-in admin's session token is not the scheduler secret (401)", d.status === 401, String(d.status));
      d = await dispatch(null);
      check("no secret -> 401 with a Bearer challenge", d.status === 401 && /Bearer/.test(d.www ?? ""), `${d.status}`);
      d = await dispatch("wrong-secret-wrong-secret");
      check("wrong secret -> 401", d.status === 401);
      d = await dispatch(null, "GET");
      check("GET without the secret -> 401", d.status === 401);
      check("nothing was sent while unauthenticated", received.length === 0);

      smsMode = "503";
      d = await dispatch(CRON, "GET");
      const first = JSON.parse(d.text);
      check("a valid secret runs a dispatch (GET works, as Vercel Cron uses GET)", d.status === 200 && first.success === true && first.data.providers.email === "email-webhook" && first.data.providers.sms === "sms-webhook", d.text.slice(0, 200));
      check("the response has counts only: no recipient or message text", !/a@example\.test|\+91\d{6}|approved|Sri Ram/.test(d.text));
      check("the same scheduled call also runs event retention and reports how many events it removed (0: all are recent)", first.data.events_purged === 0, d.text.slice(0, 200));
      check("event retention left every recent event in place", Number(psql(`SELECT count(*) FROM event_outbox`)) > 0);
      await drain();

      const mailToA = received.filter((x) => x.path === "/email" && x.body.to === "a@example.test" && x.body.template === "application_approved");
      check("the applicant's e-mail reached the gateway exactly once, with token, idempotency key, subject and a link to their application",
        mailToA.length === 1 && mailToA[0].auth === "Bearer emailtok" && /^nx-[0-9a-f-]{36}$/.test(mailToA[0].idem ?? "")
          && /Sri Ram Kirana/.test(mailToA[0].body.subject) && mailToA[0].body.html.includes(`/merchant/applications/${appA}`) && mailToA[0].body.variables.business_name === "Sri Ram Kirana",
        JSON.stringify(mailToA[0]?.body ?? {}).slice(0, 200));
      check("delivered e-mail: row is 'sent', recipient masked, payload erased (data minimisation)",
        psql(`SELECT status || '|' || recipient || '|' || data::text FROM notification_queue WHERE template = 'application_approved' AND entity_id = '${appA}' AND channel = 'email'`) === "sent|a***@example.test|{}");
      check("while the SMS gateway answered 503 the SMS stays queued for retry with the reason recorded and no number leaked",
        psql(`SELECT status || '|' || attempts || '|' || (last_error LIKE 'HTTP 503%') || '|' || (last_error !~ '\\+91') FROM notification_queue WHERE template = 'application_approved' AND entity_id = '${appA}' AND channel = 'sms'`) === "pending|1|true|true");

      // The gateway recovers; the retry time arrives.
      psql(`UPDATE notification_queue SET next_attempt_at = now() WHERE status = 'pending'`);
      smsMode = "ok";
      await drain();
      check("after the gateway recovers the SMS is delivered on retry (attempt 2) and masked",
        /^sent\|2\|\+91\*{5}\d{3}$/.test(psql(`SELECT status || '|' || attempts || '|' || recipient FROM notification_queue WHERE template = 'application_approved' AND entity_id = '${appA}' AND channel = 'sms'`)));
      const smsToA = received.filter((x) => x.path === "/sms" && x.body.template === "application_approved" && x.body.variables.application_id === appA && x.body.text);
      check("the SMS names the shop, links to the application page and never carries a reason",
        smsToA.length >= 1 && /Sri Ram Kirana/.test(smsToA.at(-1).body.text) && smsToA.at(-1).body.text.includes(`/merchant/applications/${appA}`) && !("html" in smsToA.at(-1).body) && !("subject" in smsToA.at(-1).body));

      const sentBefore = received.filter((x) => x.body.template === "application_approved" && x.body.variables?.application_id === appA && x.body.channel === "email").length;
      const again = await drain();
      check("a repeat run sends nothing twice", again.sent === 0 && received.filter((x) => x.body.template === "application_approved" && x.body.variables?.application_id === appA && x.body.channel === "email").length === sentBefore, JSON.stringify(again));

      // A request the gateway refuses outright (4xx) is final: no retry storm.
      psql(`INSERT INTO notification_queue (channel, template, recipient, entity_type, entity_id, dedupe_key, data)
            VALUES ('sms', 'help_request_update', '+919812300001', 'help_request', gen_random_uuid(), 'integration-permanent', '{"tracking_id":"HMF-KHM-209901-0001","status":"matched"}')`);
      smsMode = "422";
      await drain();
      check("a permanent gateway refusal (422) ends the message after one attempt, scrubbed",
        psql(`SELECT status || '|' || attempts || '|' || data::text FROM notification_queue WHERE dedupe_key = 'integration-permanent'`) === "failed|1|{}");
      check("the monitoring counts function reports without any personal data",
        /sent/.test(psql(`SELECT string_agg(channel || ':' || status || ':' || total, ',') FROM notification_stats()`)) && !/@|\+91/.test(psql(`SELECT string_agg(channel || status || total::text, ',') FROM notification_stats()`)));
    } finally {
      notifyProc.kill();
      await new Promise((r2) => fake.close(r2));
    }
  }
  console.log("\n— The mobile app''s own API client against the real backend —");
  // Compile apps/mobile/src/lib/api.ts (the exact client the app ships) and run it against this server.
  const ts = createRequire(import.meta.url)("typescript");
  const src = (await import("node:fs")).readFileSync(path.join(root, "apps/mobile/src/lib/api.ts"), "utf8");
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const tmp = mkdtempSync(path.join(os.tmpdir(), "nx-mobile-api-"));
  writeFileSync(path.join(tmp, "api.mjs"), out);
  const { createApiClient, ApiError } = await import(pathToFileURL(path.join(tmp, "api.mjs")).href);
  const mk = (token, extra = {}) => createApiClient({ baseUrl: APP, getToken: async () => token ?? null, timeoutMs: 8000, ...extra });
  const anonC = mk(null);
  const fails = async (p, code) => { try { await p; return false; } catch (e) { return e instanceof ApiError && e.code === code ? e : false; } };

  const taxo = await anonC.get("/taxonomy", { anonymous: true });
  check("[mobile client] reads taxonomy", taxo.categories.length === 5 && taxo.localities.length === 4);
  const home = await anonC.get("/discovery/homepage", { anonymous: true, query: { localityId: taxo.localities.find((l) => l.slug === "gandhi-chowk").id } });
  check("[mobile client] reads the homepage (categories, areas, shops, module flags)", home.categories.length === 5 && Array.isArray(home.featured_shops) && typeof home.active_modules === "object");
  const sr = await anonC.get("/discovery/search", { anonymous: true, query: { q: "sri ram", limit: 12, offset: 0 } });
  check("[mobile client] searches shops with pagination metadata", sr.total >= 1 && sr.results[0].shop_name === "Sri Ram Kirana" && sr.limit === 12);
  const sf = await anonC.get(`/storefronts/${slug}`, { anonymous: true });
  check("[mobile client] opens a storefront with shop details and items array", sf.shop.name === "Sri Ram Kirana" && Array.isArray(sf.products) && sf.storefront.slug === slug);
  const missing = await fails(anonC.get("/storefronts/no-such-shop", { anonymous: true }), "NOT_FOUND");
  check("[mobile client] maps a 404 to ApiError NOT_FOUND (not retryable)", missing && missing.retryable === false && missing.status === 404);
  const bad = await fails(anonC.get("/discovery/products", { anonymous: true, query: { q: "" } }), "VALIDATION_FAILED");
  check("[mobile client] maps a 400 to VALIDATION_FAILED", !!bad);

  const hm = await anonC.post("/help-me-find-it", { json: { item_name: "Mobile client lamp", preferred_locality_id: taxo.localities[0].id, contact_name: "Mobile Tester", contact_phone: "+919848055501", consent_given: true } });
  check("[mobile client] submits Help Me Find It anonymously and receives a tracking ID", /^HMF-KHM-\d{6}-\d{4}$/.test(hm.tracking_id));
  const tracked = await anonC.post("/help-me-find-it/track", { anonymous: true, json: { tracking_id: hm.tracking_id, contact_phone: "+919848055501" } });
  check("[mobile client] tracks it by ID + phone", tracked.status === "pending" && tracked.item_name === "Mobile client lamp");
  check("[mobile client] a wrong phone is NOT_FOUND", !!(await fails(anonC.post("/help-me-find-it/track", { anonymous: true, json: { tracking_id: hm.tracking_id, contact_phone: "+919848055502" } }), "NOT_FOUND")));
  const invalid = await fails(anonC.post("/help-me-find-it", { json: { item_name: "x", preferred_locality_id: taxo.localities[0].id, contact_name: "T", contact_phone: "123", consent_given: true } }), "VALIDATION_FAILED");
  check("[mobile client] exposes per-field server messages for forms", invalid && !!invalid.fieldMessage("contact_phone"));

  const expired = []; const ownerC = mk(tok.applicantA, { onUnauthorized: () => expired.push(1) });
  const me = await ownerC.get("/me");
  check("[mobile client] /me returns profile and server-side roles incl. merchant", me.profile.email === "applicantA@example.test" || !!me.profile.id, JSON.stringify(me.roles));
  check("[mobile client] roles come from the server (merchant after approval)", me.roles.includes("merchant"));
  const shops = (await ownerC.get("/merchant/shops")).businesses;
  const msh = shops[0].business.shops[0];
  check("[mobile client] lists the owner's shops with role and storefront", shops[0].role === "owner" && msh.name === "Sri Ram Kirana" && msh.storefront.slug === slug);
  await ownerC.patch(`/merchant/shops/${msh.id}`, { json: { headline: "Edited from the app", operating_hours: { opens: "08:00", closes: "20:30", closed_days: ["monday"] } } });
  check("[mobile client] edits shop details and the website shows it", /Edited from the app/.test((await call("GET", `/shop/${slug}`)).text));
  const vErr = await fails(ownerC.patch(`/merchant/shops/${msh.id}`, { json: { phone: "12" } }), "VALIDATION_FAILED");
  check("[mobile client] a bad phone returns a field message the form can show", vErr && !!vErr.fieldMessage("phone"));
  const created = await ownerC.post(`/merchant/shops/${msh.id}/products`, { json: { name: "App Item", price: 55, unit: "kg", stock_status: "in_stock" } });
  const list1 = (await ownerC.get(`/merchant/shops/${msh.id}/products`)).products;
  check("[mobile client] adds an item; it comes back with the effective stock label", list1.some((x) => x.id === created.product_id && x.effective_stock_status === "in_stock"));
  await ownerC.patch(`/merchant/shops/${msh.id}/products/${created.product_id}`, { json: { confirm_stock: true } });
  await ownerC.patch(`/merchant/shops/${msh.id}/products/${created.product_id}`, { json: { stock_status: "out_of_stock", price: 60 } });
  const list2 = (await ownerC.get(`/merchant/shops/${msh.id}/products`)).products.find((x) => x.id === created.product_id);
  check("[mobile client] re-confirms and updates stock and price", list2.stock_status === "out_of_stock" && list2.price === 60);
  const form = new FormData(); form.append("file", new Blob(["not an image"], { type: "image/jpeg" }), "x.jpg");
  check("[mobile client] a fake photo upload is refused with VALIDATION_FAILED", !!(await fails(ownerC.post(`/merchant/shops/${msh.id}/products/${created.product_id}/image`, { form }), "VALIDATION_FAILED")));
  await ownerC.delete(`/merchant/shops/${msh.id}/products/${created.product_id}`);
  check("[mobile client] deletes the item", !(await ownerC.get(`/merchant/shops/${msh.id}/products`)).products.some((x) => x.id === created.product_id));

  const staffC = mk(tok.customer2);
  check("[mobile client] staff are refused edits with FORBIDDEN", !!(await fails(staffC.patch(`/merchant/shops/${msh.id}`, { json: { headline: "no" } }), "FORBIDDEN")));
  const strangerC = mk(tok.applicantB);
  check("[mobile client] a stranger gets NOT_FOUND for another merchant's shop", !!(await fails(strangerC.get(`/merchant/shops/${msh.id}/products`), "NOT_FOUND")));
  check("[mobile client] no token on a private endpoint is UNAUTHENTICATED and does not trigger sign-out handling", !!(await fails(mk(null, { onUnauthorized: () => expired.push(2) }).get("/me"), "UNAUTHENTICATED")) && expired.length === 0);
  check("[mobile client] a rejected token is UNAUTHENTICATED and triggers the sign-out handler", !!(await fails(mk("not.a.jwt", { onUnauthorized: () => expired.push(3) }).get("/me"), "UNAUTHENTICATED")) && expired.includes(3));
  const t0 = Date.now();
  const off = await fails(createApiClient({ baseUrl: "http://127.0.0.1:9", getToken: async () => null, timeoutMs: 3000 }).get("/taxonomy", { anonymous: true }), "NETWORK");
  check("[mobile client] an unreachable server is NETWORK (retryable) after one automatic retry", off && off.retryable === true && Date.now() - t0 < 12000);
}

// ---------------------------------------------------------------- main
let exitCode = 1;
let appEnv;
try {
  const anonKey = jwt({ role: "anon" });
  const env = {
    ...process.env, NEXT_DIST_DIR: DIST, NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${GATEWAY_PORT}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "service_role" }),
    NEXT_PUBLIC_APP_URL: APP, NODE_ENV: "production",
  };
  delete env.NODE_ENV;
  // The suite sends hundreds of requests from one address; the dedicated rate-limit checks use a second, strict instance.
  Object.assign(env, { API_RATE_LIMIT_READ: "1000000", API_RATE_LIMIT_WRITE: "1000000", API_RATE_LIMIT_SENSITIVE: "1000000" });
  appEnv = env;
  console.log("Starting Postgres + PostgREST …");
  await startStack();
  await startGateway(anonKey);
  build(env);
  await startApp({ ...env, NODE_ENV: "production" });
  await scenarios();
  exitCode = failures.length === 0 ? 0 : 1;
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) console.log("Failures:\n- " + failures.join("\n- "));
} catch (e) {
  console.error("\nIntegration test aborted:", e.message ?? e);
} finally {
  await stopStack();
}
process.exit(exitCode);
