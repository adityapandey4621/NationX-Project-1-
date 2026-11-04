#!/usr/bin/env node
// Applies migrations + seed to ONE throwaway postgres:16-alpine container
// (RAM-backed, removed afterwards) and runs supabase/tests/*.test.sql.
// Far lighter than `supabase start` (~10 containers). Requires Docker running.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const name = `nationx-testdb-${process.pid}`;

function docker(args, { allowFail = false, quiet = false } = {}) {
  const r = spawnSync("docker", args, { encoding: "utf8" });
  if (!quiet && r.stdout) process.stdout.write(r.stdout);
  if (r.status !== 0 && !allowFail) {
    if (r.stderr) process.stderr.write(r.stderr);
    throw new Error(`docker ${args.slice(0, 2).join(" ")} failed (exit ${r.status})`);
  }
  return r;
}

function psqlFile(file) {
  console.log(`> ${file}`);
  docker(["exec", name, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", `/work/${file}`]);
}

let failed = false;
try {
  docker(["run", "-d", "--rm", "--name", name, "--tmpfs", "/var/lib/postgresql/data",
    "-e", "POSTGRES_PASSWORD=test", "postgres:16-alpine"], { quiet: true });
  for (let i = 0; i < 60; i++) {
    if (docker(["exec", name, "pg_isready", "-U", "postgres"], { allowFail: true, quiet: true }).status === 0) break;
    spawnSync("node", ["-e", "setTimeout(()=>{},500)"]);
  }
  // Postgres restarts once during init; wait until a query really works.
  for (let i = 0; i < 60; i++) {
    if (docker(["exec", name, "psql", "-U", "postgres", "-tAc", "select 1"], { allowFail: true, quiet: true }).stdout?.trim() === "1") break;
    spawnSync("node", ["-e", "setTimeout(()=>{},500)"]);
  }
  docker(["cp", path.join(root, "supabase"), `${name}:/work`], { quiet: true });

  psqlFile("tests/stub_supabase.sql");
  for (const f of readdirSync(path.join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    psqlFile(`migrations/${f}`);
  }
  psqlFile("seed.sql");
  psqlFile("seed.sql"); // idempotency check
  for (const f of readdirSync(path.join(root, "supabase", "tests")).filter((f) => f.endsWith(".test.sql")).sort()) {
    psqlFile(`tests/${f}`);
  }
  console.log("DB tests passed.");
} catch (e) {
  failed = true;
  console.error(String(e.message ?? e));
} finally {
  docker(["rm", "-f", name], { allowFail: true, quiet: true });
}
process.exit(failed ? 1 : 0);
