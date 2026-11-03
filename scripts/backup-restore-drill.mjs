#!/usr/bin/env node
// Backup & restore drill (AC-21): populate a database through the real workflows, take a pg_dump (data only), restore it into a
// brand-new database built from the migrations and prove that data, security (RLS, policies, triggers, functions) and behaviour survived.
// This exercises the PROCEDURE in docs/DEPLOYMENT.md on plain Postgres 16. It is not a drill against the hosted
// Supabase project (that needs your project and its backup access).
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const A = `nationx-bk-src-${process.pid}`, B = `nationx-bk-dst-${process.pid}`;
const docker = (args, input) => spawnSync("docker", args, { encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 });
const sh = (c, args, sql) => { const r = docker(["exec", "-i", c, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-tA", ...args], sql); if (r.status !== 0) throw new Error(`psql(${c}) failed: ${r.stderr}`); return r.stdout.trim(); };
let passed = 0; const failures = [];
const check = (name, ok, detail = "") => { if (ok) passed++; else failures.push(`${name}${detail ? ` - ${detail}` : ""}`); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` (${detail})` : ""}`); };

async function boot(name) {
  docker(["run", "-d", "--rm", "--name", name, "--tmpfs", "/var/lib/postgresql/data", "-e", "POSTGRES_PASSWORD=pw", "postgres:16-alpine"]);
  for (let i = 0; i < 80; i++) { if (docker(["exec", name, "psql", "-U", "postgres", "-tAc", "select 1"]).stdout?.trim() === "1") break; await new Promise((r) => setTimeout(r, 500)); }
  docker(["cp", path.join(root, "supabase"), `${name}:/work`]);
}
const file = (c, f) => { const r = docker(["exec", c, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", `/work/${f}`]); if (r.status !== 0) throw new Error(`${f}: ${r.stderr}`); };

const fingerprint = (c) => sh(c, [], `
  SELECT string_agg(t || '=' || n || ':' || h, ';' ORDER BY t) FROM (
    SELECT 'businesses' t, count(*) n, md5(coalesce(string_agg(id::text||name, ',' ORDER BY id), '')) h FROM businesses UNION ALL
    SELECT 'shops', count(*), md5(coalesce(string_agg(id::text||name||phone, ',' ORDER BY id), '')) FROM shops UNION ALL
    SELECT 'storefronts', count(*), md5(coalesce(string_agg(id::text||slug||visibility_status||search_text, ',' ORDER BY id), '')) FROM storefronts UNION ALL
    SELECT 'products', count(*), md5(coalesce(string_agg(id::text||name||coalesce(price::text,'')||stock_status||coalesce(stock_confirmed_at::text,''), ',' ORDER BY id), '')) FROM storefront_products UNION ALL
    SELECT 'applications', count(*), md5(coalesce(string_agg(id::text||status, ',' ORDER BY id), '')) FROM merchant_applications UNION ALL
    SELECT 'help_requests', count(*), md5(coalesce(string_agg(id::text||tracking_id||status, ',' ORDER BY id), '')) FROM help_me_find_it_requests UNION ALL
    SELECT 'audit_logs', count(*), md5(coalesce(string_agg(id::text||action, ',' ORDER BY id), '')) FROM audit_logs UNION ALL
    SELECT 'user_roles', count(*), md5(coalesce(string_agg(user_id::text||role, ',' ORDER BY user_id, role), '')) FROM user_roles UNION ALL
    SELECT 'profiles', count(*), md5(coalesce(string_agg(id::text||phone, ',' ORDER BY id), '')) FROM profiles UNION ALL
    SELECT 'localities', count(*), md5(coalesce(string_agg(id::text||slug, ',' ORDER BY id), '')) FROM localities
  ) x`);
const structure = (c) => sh(c, [], `SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity) || ' rls-tables; ' ||
  (SELECT count(*) FROM pg_policies WHERE schemaname='public') || ' policies; ' ||
  (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal) || ' triggers; ' ||
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') || ' functions'`);

let code = 1;
try {
  console.log("Building the source database through the real workflows …");
  await boot(A);
  for (const f of ["tests/stub_supabase.sql", ...readdirSync(path.join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort().map((f) => `migrations/${f}`), "seed.sql"]) file(A, f);
  const admin = randomUUID(), owner = randomUUID(), cust = randomUUID(), app = randomUUID();
  sh(A, [], `INSERT INTO auth.users (id,email,raw_user_meta_data) VALUES ('${admin}','a@x.test','{"full_name":"A","phone":"+919000000011"}'),('${owner}','o@x.test','{"full_name":"O","phone":"+919000000012"}'),('${cust}','c@x.test','{"full_name":"C","phone":"+919000000013"}');
    INSERT INTO user_roles (user_id, role) VALUES ('${admin}','admin');
    INSERT INTO merchant_applications (id, applicant_user_id, business_name, category_id, locality_id, contact_phone, address_line1, declaration_accepted, status)
      SELECT '${app}','${owner}','Drill Kirana',(SELECT id FROM categories WHERE slug='kirana'),(SELECT id FROM localities WHERE slug='gandhi-chowk'),'+919848011223','Near Old Bus Stand',true,'submitted';`);
  sh(A, [], `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${admin}',false) \\g /dev/null
    SELECT approve_merchant_application('${app}');`);
  sh(A, [], `INSERT INTO storefront_products (shop_id, name, name_te, price, stock_status) SELECT s.id, 'Drill Rice', 'బియ్యం', 120, 'in_stock' FROM shops s JOIN businesses b ON b.id=s.business_id WHERE b.name='Drill Kirana';
    SELECT submit_help_request('Drill sesame oil', NULL, (SELECT id FROM localities WHERE slug='gandhi-chowk'), NULL, 'Cust', '+919848055599', NULL, true);`);
  const before = fingerprint(A), structBefore = structure(A);
  console.log("  source:", structBefore);

  console.log("Taking the backup (pg_dump custom format, DATA ONLY: public schema + auth.users) …");
  const t0 = Date.now();
  let r = docker(["exec", A, "sh", "-c", "pg_dump -U postgres -Fc --data-only -t 'public.*' -t auth.users -f /tmp/nationx.dump && ls -l /tmp/nationx.dump"]);
  check("pg_dump completes", r.status === 0, r.stderr);
  const dir = mkdtempSync(path.join(os.tmpdir(), "nx-backup-"));
  docker(["cp", `${A}:/tmp/nationx.dump`, path.join(dir, "nationx.dump")]);
  const size = statSync(path.join(dir, "nationx.dump")).size;
  check(`the backup file exists and is non-empty (${size} bytes, ${Date.now() - t0} ms)`, size > 1000);

  console.log("Restoring into a brand-new database …");
  await boot(B);
  // Procedure: the SCHEMA always comes from git (migrations), the DATA from the backup. A fresh Supabase project already has
  // its roles and auth schema; the stub stands in for them here. Migrations are applied WITHOUT seed.sql: the backup has the data.
  file(B, "tests/stub_supabase.sql");
  for (const f of readdirSync(path.join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort()) file(B, `migrations/${f}`);
  docker(["cp", path.join(dir, "nationx.dump"), `${B}:/tmp/nationx.dump`]);
  const t1 = Date.now();
  r = docker(["exec", B, "pg_restore", "-U", "postgres", "-d", "postgres", "--data-only", "--disable-triggers", "--no-owner", "--exit-on-error", "/tmp/nationx.dump"]);
  check(`pg_restore completes without errors (${Date.now() - t1} ms)`, r.status === 0, r.stderr.slice(0, 400));

  const after = fingerprint(B);
  check("every table has identical row counts AND content checksums after the restore", after === before, `\n  before ${before}\n  after  ${after}`);
  const structAfter = structure(B);
  check("RLS tables, policies, triggers and functions all came back", structAfter === structBefore, `${structBefore} vs ${structAfter}`);
  check("the restored database still enforces audit immutability", (() => { try { sh(B, [], "UPDATE audit_logs SET action='tamper'"); return false; } catch { return true; } })());
  const anonCount = sh(B, [], `SET ROLE anon; SELECT count(*) FROM storefronts;`);
  check("RLS still limits anonymous readers to published storefronts after the restore", anonCount === "1", anonCount);
  check("workflow functions still work on the restored database (idempotent re-approval)", (() => { try { sh(B, [], `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${admin}',false) \\g /dev/null\nSELECT (approve_merchant_application('${app}')->>'already_approved');`); return true; } catch { return false; } })());
  check("search works on the restored database", sh(B, [], `SET ROLE anon; SELECT count(*) FROM search_storefronts('drill')`) === "1");

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) console.log("Failures:\n- " + failures.join("\n- "));
  code = failures.length ? 1 : 0;
} catch (e) {
  console.error("Drill aborted:", e.message ?? e);
} finally {
  docker(["rm", "-f", A, B]);
}
process.exit(code);