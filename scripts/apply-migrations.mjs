import postgres from "postgres";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Read .env.local
const envContent = fs.readFileSync(path.join(root, ".env.local"), "utf8");
let dbUrl = "";
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (trimmed.startsWith("DATABASE_URL=")) {
    dbUrl = trimmed.substring("DATABASE_URL=".length).trim();
    if (dbUrl.startsWith('"') && dbUrl.endsWith('"')) {
      dbUrl = dbUrl.slice(1, -1);
    }
  }
}

if (!dbUrl) {
  console.error("No DATABASE_URL found in .env.local");
  process.exit(1);
}

console.log("Connecting to database...");

// Use ssl: 'require' and prepare: false for Supabase pooler
const sql = postgres(dbUrl, {
  ssl: "require",
  prepare: false,
});

async function main() {
  try {
    const [{ version }] = await sql`SELECT version()`;
    console.log("Connected successfully! PostgreSQL version:", version.split(" ")[0], version.split(" ")[1]);

    const migrationsDir = path.join(root, "supabase", "migrations");
    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    console.log(`\nFound ${migrationFiles.length} migration files:`);
    for (const f of migrationFiles) {
      console.log(`- ${f}`);
    }

    for (const f of migrationFiles) {
      console.log(`\n>>> Applying ${f}...`);
      const sqlContent = fs.readFileSync(path.join(migrationsDir, f), "utf8");
      await sql.unsafe(sqlContent);
      console.log(`✓ Applied ${f}`);
    }

    const seedFile = path.join(root, "supabase", "seed.sql");
    if (fs.existsSync(seedFile)) {
      console.log(`\n>>> Applying seed.sql...`);
      const seedContent = fs.readFileSync(seedFile, "utf8");
      await sql.unsafe(seedContent);
      console.log(`✓ Applied seed.sql`);
    }

    console.log("\n>>> Checking database tables in public schema:");
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `;
    console.log("Created tables:", tables.map((t) => t.table_name));

    console.log("\nAll migrations and seeds successfully applied!");
  } catch (err) {
    console.error("Migration error:", err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();

