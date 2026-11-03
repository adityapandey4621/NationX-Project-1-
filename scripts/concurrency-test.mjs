#!/usr/bin/env node
// Concurrency tests against real PostgreSQL: many simultaneous database sessions (one psql process each) race
// on the operations where duplicates or inconsistent state would hurt. Needs Docker; one throwaway container.
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = `nationx-conc-${process.pid}`;
let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) passed++; else failures.push(`${name}${detail ? ` - ${detail}` : ""}`);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` (${detail})` : ""}`);
};

const docker = (args) => spawnSync("docker", args, { encoding: "utf8" });
function run(sql) {
  return new Promise((resolve) => {
    const p = spawn("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-q", "-tA", "-v", "ON_ERROR_STOP=1"]);
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ ok: code === 0, out: out.trim(), err: err.trim() }));
    p.stdin.end(sql);
  });
}
const one = async (sql) => (await run(sql)).out;
// All sessions wait for the same wall-clock instant, so their statements genuinely overlap.
const barrier = (ms = 2500) => { const at = new Date(Date.now() + ms).toISOString(); return `SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM (TIMESTAMPTZ '${at}' - clock_timestamp())))) \\g /dev/null\n`; };
const as = (uid, role, sql) => `SET ROLE ${role}; SELECT set_config('request.jwt.claim.sub','${uid}',false) \\g /dev/null\n${sql}`;

async function start() {
  docker(["run", "-d", "--rm", "--name", DB, "--tmpfs", "/var/lib/postgresql/data", "-e", "POSTGRES_PASSWORD=test", "-e", "POSTGRES_INITDB_ARGS=--auth=trust", "postgres:16-alpine"]);
  for (let i = 0; i < 80; i++) {
    if (docker(["exec", DB, "psql", "-U", "postgres", "-tAc", "select 1"]).stdout?.trim() === "1") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  docker(["cp", path.join(root, "supabase"), `${DB}:/work`]);
  const files = ["tests/stub_supabase.sql", ...readdirSync(path.join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql") && !(process.env.SKIP_MIGRATIONS ?? "").split(",").some((s) => s && f.startsWith(s))).sort().map((f) => `migrations/${f}`), "seed.sql"];
  for (const f of files) {
    const r = docker(["exec", DB, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", `/work/${f}`]);
    if (r.status !== 0) throw new Error(`${f} failed: ${r.stderr}`);
  }
}

async function scenarios() {
  const admin = randomUUID();
  const mk = (n) => Array.from({ length: n }, () => randomUUID());
  const applicants = mk(10);
  const users = [admin, ...applicants];
  await run(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ${users.map((u, i) => `('${u}','u${i}@x.test','{"full_name":"U${i}","phone":"+91900001${String(i).padStart(4, "0")}"}')`).join(",")};
    INSERT INTO user_roles (user_id, role) VALUES ('${admin}','admin');`);
  const cat = await one(`SELECT id FROM categories WHERE slug='kirana'`);
  const loc = await one(`SELECT id FROM localities WHERE slug='gandhi-chowk'`);
  const submitted = (id, applicant, name) => `INSERT INTO merchant_applications (id, applicant_user_id, business_name, category_id, locality_id, contact_phone, address_line1, declaration_accepted, status)
    VALUES ('${id}','${applicant}','${name}','${cat}','${loc}','+919848011223','Near Old Bus Stand', true, 'submitted');`;

  console.log("\n— Same application approved by 8 sessions at once —");
  const app1 = randomUUID();
  await run(submitted(app1, applicants[0], "Race Mart"));
  const b0 = barrier(); const res = await Promise.all(Array.from({ length: 8 }, () => run(b0 + as(admin, "authenticated", `SELECT approve_merchant_application('${app1}')`))));
  check("every concurrent approval call succeeds (idempotent)", res.every((x) => x.ok), res.find((x) => !x.ok)?.err);
  const counts = await one(`SELECT (SELECT count(*) FROM businesses WHERE origin_application_id='${app1}'), (SELECT count(*) FROM shops s JOIN businesses b ON b.id=s.business_id WHERE b.origin_application_id='${app1}'), (SELECT count(*) FROM storefronts sf JOIN shops s ON s.id=sf.shop_id JOIN businesses b ON b.id=s.business_id WHERE b.origin_application_id='${app1}'), (SELECT count(*) FROM user_roles WHERE user_id='${applicants[0]}' AND role='merchant'), (SELECT count(*) FROM audit_logs WHERE entity_id='${app1}' AND action LIKE '%approved%')`);
  check("exactly one business, one shop, one storefront, one merchant role, one audit row", counts === "1|1|1|1|1", counts);

  console.log("\n— Eight different shops with the SAME name and area approved at once —");
  const ids = Array.from({ length: 8 }, () => randomUUID());
  await run(ids.map((id, i) => submitted(id, applicants[i + 1] ?? applicants[1], "Sri Lakshmi Kirana").replace(/\n/g, " ")).filter((_, i) => i < 8).map((s, i) => (i < 8 && i + 1 < applicants.length ? s : "")).join("\n"));
  const usable = ids.slice(0, applicants.length - 1);
  const bs = barrier(); const r2 = await Promise.all(usable.map((id) => run(bs + as(admin, "authenticated", `SELECT approve_merchant_application('${id}')`))));
  check("all concurrent approvals succeed", r2.every((x) => x.ok), r2.find((x) => !x.ok)?.err);
  const slugs = (await one(`SELECT string_agg(sf.slug, ',') FROM storefronts sf JOIN shops s ON s.id=sf.shop_id JOIN businesses b ON b.id=s.business_id WHERE b.name='Sri Lakshmi Kirana'`)).split(",");
  check(`${usable.length} stores get ${usable.length} distinct slugs (no collision, no failure)`, slugs.length === usable.length && new Set(slugs).size === usable.length, slugs.join(" "));
  check("slugs follow the deterministic pattern", slugs.every((s) => /^sri-lakshmi-kirana-gandhi-chowk(-\d+)?$/.test(s)));

  console.log("\n— Approve and reject the same application simultaneously —");
  const pairs = Array.from({ length: 6 }, () => randomUUID());
  // Distinct applicants are scarce (one open application each), so reuse them in rounds.
  let consistent = true, detail = "";
  for (let round = 0; round < 3; round++) {
    const rows = pairs.map((id, i) => ({ id: randomUUID(), applicant: applicants[(i + 3) % applicants.length] }));
    await run(rows.map((x) => `DELETE FROM merchant_applications WHERE applicant_user_id='${x.applicant}' AND status IN ('submitted','draft','correction_requested');`).join("\n"));
    await run(rows.map((x) => submitted(x.id, x.applicant, `Contested ${round}-${x.id.slice(0, 4)}`)).join("\n"));
    await Promise.all(rows.flatMap((x) => [
      run(as(admin, "authenticated", `SELECT approve_merchant_application('${x.id}')`)),
      run(as(admin, "authenticated", `SELECT review_merchant_application('${x.id}','reject','racing decision')`)),
    ]));
    for (const x of rows) {
      const s = await one(`SELECT a.status || '|' || (SELECT count(*) FROM businesses WHERE origin_application_id=a.id) FROM merchant_applications a WHERE a.id='${x.id}'`);
      if (!["approved|1", "rejected|0"].includes(s)) { consistent = false; detail = s; }
    }
  }
  check("an application is either approved WITH its business or rejected with NONE - never a mix", consistent, detail);

  console.log("\n— Help Me Find It under parallel load —");
  const hmf = (phone, n) => `SELECT submit_help_request('Item ${n}', NULL, '${loc}', NULL, 'Tester', '${phone}', NULL, true)`;
  const b1 = barrier(); const burst = await Promise.all(Array.from({ length: 12 }, (_, i) => run(b1 + hmf("+919800000001", i))));
  const okCount = burst.filter((x) => x.ok).length;
  check("12 simultaneous requests from one phone: exactly 5 are accepted", okCount === 5, `accepted ${okCount}`);
  check("...and the rest are refused as throttled (program_limit_exceeded), not as errors", burst.filter((x) => !x.ok).every((x) => /too many requests/.test(x.err)));
  const b2 = barrier(); const many = await Promise.all(Array.from({ length: 20 }, (_, i) => run(b2 + hmf(`+9198000001${String(i).padStart(2, "0")}`, i))));
  check("20 simultaneous requests from different phones all succeed", many.every((x) => x.ok), many.find((x) => !x.ok)?.err);
  const tids = (await one(`SELECT string_agg(tracking_id, ',') FROM help_me_find_it_requests`)).split(",");
  check("every tracking ID is unique", new Set(tids).size === tids.length, `${tids.length} rows`);
  const seqs = tids.map((t) => Number(t.split("-")[3])).sort((a, b) => a - b);
  check("tracking numbers are gap-free per month (1..N)", seqs.every((v, i) => v === i + 1), seqs.join(","));

  console.log("\n— Item limit and duplicate-application guard —");
  const owner = applicants[9];
  const shop = randomUUID(), biz = randomUUID();
  await run(`INSERT INTO businesses (id, name, primary_owner_id) VALUES ('${biz}','Cap Biz','${owner}');
    INSERT INTO business_members (business_id, user_id, role) VALUES ('${biz}','${owner}','owner');
    INSERT INTO shops (id, business_id, name, shop_code, category_id, locality_id, address_line, phone) VALUES ('${shop}','${biz}','Cap Shop','MAIN','${cat}','${loc}','a','+919100000009');
    INSERT INTO storefront_products (shop_id, name) SELECT '${shop}', 'Filler ' || g FROM generate_series(1, 495) g;`);
  const b3 = barrier(); const ins = await Promise.all(Array.from({ length: 15 }, (_, i) => run(b3 + as(owner, "authenticated", `INSERT INTO storefront_products (shop_id, name) VALUES ('${shop}', 'Racer ${i}')`))));
  check("495 items + 15 simultaneous inserts: exactly 5 succeed", ins.filter((x) => x.ok).length === 5, `accepted ${ins.filter((x) => x.ok).length}`);
  check("the shop ends at exactly 500 items", (await one(`SELECT count(*) FROM storefront_products WHERE shop_id='${shop}'`)) === "500");

  const dup = applicants[8];
  await run(`DELETE FROM merchant_applications WHERE applicant_user_id='${dup}'`);
  const b4 = barrier(); const drafts = await Promise.all(Array.from({ length: 6 }, () => run(b4 + as(dup, "authenticated", `INSERT INTO merchant_applications (applicant_user_id, business_name, category_id, locality_id, contact_phone, address_line1, status) VALUES ('${dup}','Dup Draft','${cat}','${loc}','+919848011223','x','draft')`))));
  check("6 simultaneous identical drafts (same applicant, name, area): exactly 1 is stored", drafts.filter((x) => x.ok).length === 1, `stored ${drafts.filter((x) => x.ok).length}`);
}

let code = 1;
try {
  console.log("Starting Postgres …");
  await start();
  await scenarios();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) failures.forEach((f) => console.log(`  FAILED: ${f}`));
  code = failures.length ? 1 : 0;
} catch (e) {
  console.error(String(e?.stack ?? e));
} finally {
  docker(["rm", "-f", DB]);
}
process.exit(code);