#!/usr/bin/env node
// Applies the SQL files in supabase/migrations to the database in DATABASE_URL, once each, in order.
//
//   npm run db:migrate -- --dry-run                 show what would be applied, change nothing
//   npm run db:migrate                              apply every pending migration (each in its own transaction)
//   npm run db:migrate -- --baseline-through 015    FIRST RUN ONLY on a database that already contains migrations
//                                                   001..015: record them as applied WITHOUT running them
//
// History is kept in public.schema_migrations (RLS on, no policies: not readable through the API). A migration that
// fails is rolled back completely and nothing after it runs. Re-running is always safe. The seed file is not part of
// this runner (it is applied once at setup: see docs/SETUP.md).
import postgres from "postgres";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const bi = args.indexOf("--baseline-through");
const baseline = bi >= 0 ? args[bi + 1] : null;
if (bi >= 0 && !/^\d{3}$/.test(baseline ?? "")) {
  console.error("--baseline-through needs a three-digit migration number, e.g. --baseline-through 015");
  process.exit(2);
}

function readDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const file = path.join(root, ".env.local");
  if (!fs.existsSync(file)) return "";
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*DATABASE_URL\s*=\s*(.*)$/.exec(line);
    if (m) return m[1].trim().replace(/^"|"$/g, "");
  }
  return "";
}

const url = readDatabaseUrl();
if (!url) {
  console.error("No DATABASE_URL (environment or .env.local).");
  process.exit(2);
}
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const sql = postgres(url, { ssl: local ? false : "require", prepare: false, onnotice: () => undefined, max: 1 });

const dir = path.join(root, "supabase", "migrations");
const files = fs.readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();

try {
  const [{ version }] = await sql`SELECT version()`;
  console.log(`Connected: ${version.split(" ").slice(0, 2).join(" ")}  (${local ? "local" : "remote, TLS"})`);

  await sql`CREATE TABLE IF NOT EXISTS public.schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY`;
  await sql`REVOKE ALL ON public.schema_migrations FROM PUBLIC`;
  await sql.unsafe(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON public.schema_migrations FROM anon'; END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE ALL ON public.schema_migrations FROM authenticated'; END IF;
  END $$`);

  const applied = new Set((await sql`SELECT name FROM public.schema_migrations`).map((r) => r.name));

  if (applied.size === 0 && !baseline) {
    const [{ has }] = await sql`SELECT to_regclass('public.profiles') IS NOT NULL AS has`;
    if (has) {
      console.error(
        "\nThis database already contains NationX tables but has no migration history, so the runner cannot tell which\n" +
        "migrations were applied. Check which ones it has, then record them once WITHOUT running them:\n" +
        "    npm run db:migrate -- --baseline-through <last migration number it contains>\n" +
        "Nothing was changed.",
      );
      process.exit(3);
    }
  }

  if (baseline) {
    const toRecord = files.filter((f) => f.slice(0, 3) <= baseline && !applied.has(f));
    if (!files.some((f) => f.startsWith(`${baseline}_`))) {
      console.error(`No migration numbered ${baseline} exists.`);
      process.exit(2);
    }
    if (dryRun) console.log(`Would record as already applied (not run): ${toRecord.join(", ") || "none"}`);
    else {
      for (const f of toRecord) await sql`INSERT INTO public.schema_migrations (name) VALUES (${f}) ON CONFLICT DO NOTHING`;
      console.log(`Recorded as already applied (not run): ${toRecord.join(", ") || "none"}`);
    }
    for (const f of toRecord) applied.add(f);
  }

  const pending = files.filter((f) => !applied.has(f));
  const unknown = [...applied].filter((n) => !files.includes(n));
  if (unknown.length) console.warn(`Warning: history lists migrations not in this repo: ${unknown.join(", ")}`);

  if (pending.length === 0) {
    console.log("Up to date: no pending migrations.");
  } else if (dryRun) {
    console.log(`Pending (${pending.length}), not applied because of --dry-run:\n  ${pending.join("\n  ")}`);
  } else {
    for (const f of pending) {
      const body = fs.readFileSync(path.join(dir, f), "utf8");
      process.stdout.write(`Applying ${f} … `);
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`INSERT INTO public.schema_migrations (name) VALUES (${f})`;
      });
      console.log("done");
    }
    console.log(`Applied ${pending.length} migration(s).`);
  }
} catch (e) {
  console.error(`\nMigration failed and was rolled back: ${e.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
