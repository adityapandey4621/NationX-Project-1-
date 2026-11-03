#!/usr/bin/env node
// Local development stack with SAMPLE marketplace data (no Supabase account needed).
//
//   npm run dev:stack             Next dev server on http://127.0.0.1:3100
//   npm run dev:stack -- --prod   production build + server (for layout/screenshot checks)
//   npm run dev:stack -- --empty  no sample listings (to look at the empty states)
//
// Starts a throwaway Postgres + PostgREST in Docker, applies every migration and
// seed.sql, then supabase/dev-seed.sql (clearly labelled sample listings). A tiny
// gateway stands in for Supabase's edge, exactly as in scripts/integration-test.mjs.
// Data lives in RAM and is discarded when you press Ctrl-C. It never touches the
// hosted Supabase project, and dev-seed.sql cannot run anywhere but this stack.
import { spawn, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import http from "node:http";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const SECRET = "dev-stack-secret-dev-stack-secret-dev-stack";
const NET = "nx-dev";
const DB = "nx-dev-db";
const REST = "nx-dev-rest";
const REST_PORT = 3102;
const GATEWAY_PORT = 54398;
const APP_PORT = Number(process.env.APP_PORT ?? 3100);

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims) => {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const p = b64({ iss: "nx-dev", exp: Math.floor(Date.now() / 1000) + 86400 * 30, ...claims });
  return `${h}.${p}.${createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const docker = (a, input) => spawnSync("docker", a, { encoding: "utf8", input });
const psqlFile = (file) => {
  const r = docker(["exec", DB, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", `/work/${file}`]);
  if (r.status !== 0) throw new Error(`${file} failed:\n${r.stderr}`);
};

let gateway;
let app;
function stop() {
  app?.kill();
  gateway?.close();
  docker(["rm", "-f", DB, REST]);
  docker(["network", "rm", NET]);
}

async function main() {
  docker(["rm", "-f", DB, REST]);
  docker(["network", "rm", NET]);
  docker(["network", "create", NET]);
  const run = docker(["run", "-d", "--rm", "--name", DB, "--network", NET, "--tmpfs", "/var/lib/postgresql/data", "-e", "POSTGRES_PASSWORD=pw", "postgres:16-alpine"]);
  if (run.status !== 0) throw new Error(`could not start Postgres (is Docker running?): ${run.stderr}`);
  for (let i = 0; i < 80; i++) {
    if (docker(["exec", DB, "psql", "-U", "postgres", "-tAc", "select 1"]).stdout?.trim() === "1") break;
    await sleep(500);
  }
  docker(["cp", path.join(root, "supabase"), `${DB}:/work`]);
  psqlFile("tests/stub_supabase.sql");
  docker(["exec", "-i", DB, "psql", "-U", "postgres", "-q"], "CREATE ROLE authenticator LOGIN PASSWORD 'pw' NOINHERIT; GRANT anon, authenticated, service_role TO authenticator;");
  for (const f of readdirSync(path.join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort()) psqlFile(`migrations/${f}`);
  psqlFile("seed.sql");
  if (!args.has("--empty")) psqlFile("dev-seed.sql");

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

  const anonKey = jwt({ role: "anon" });
  gateway = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const auth = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (url.pathname.startsWith("/rest/v1/")) {
      const chunks = [];
      for await (const ch of req) chunks.push(ch);
      const headers = { ...req.headers };
      for (const k of ["host", "connection", "content-length", "apikey"]) delete headers[k];
      if (auth === anonKey) delete headers.authorization;
      const upstream = await fetch(`http://127.0.0.1:${REST_PORT}${url.pathname.slice("/rest/v1".length)}${url.search}`, {
        method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
      });
      const out = Buffer.from(await upstream.arrayBuffer());
      const h = Object.fromEntries([...upstream.headers].filter(([k]) => !["content-encoding", "transfer-encoding", "content-length", "connection"].includes(k)));
      res.writeHead(upstream.status, h).end(out);
      return;
    }
    // Sign-in is not available on this stack (there is no GoTrue); anonymous browsing is.
    res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ msg: "no auth server in dev:stack" }));
  });
  await new Promise((r) => gateway.listen(GATEWAY_PORT, "127.0.0.1", r));

  const env = {
    ...process.env, NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${GATEWAY_PORT}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "service_role" }), NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${APP_PORT}`,
    API_RATE_LIMIT_READ: "1000000", API_RATE_LIMIT_WRITE: "1000000", API_RATE_LIMIT_SENSITIVE: "1000000",
  };
  delete env.NODE_ENV;
  const next = path.join(root, "node_modules/next/dist/bin/next");
  if (args.has("--prod")) {
    const dist = ".next-devstack";
    const b = spawnSync(process.execPath, [next, "build"], { cwd: root, env: { ...env, NEXT_DIST_DIR: dist }, stdio: "inherit" });
    if (b.status !== 0) throw new Error("build failed");
    app = spawn(process.execPath, [next, "start", "-p", String(APP_PORT)], { cwd: root, env: { ...env, NEXT_DIST_DIR: dist, NODE_ENV: "production" }, stdio: "inherit" });
  } else {
    app = spawn(process.execPath, [next, "dev", "-p", String(APP_PORT)], { cwd: root, env, stdio: "inherit" });
  }
  console.log(`\nNationX dev stack → http://127.0.0.1:${APP_PORT}  (${args.has("--empty") ? "no sample data" : "SAMPLE listings loaded"}; Ctrl-C to stop)\n`);
  await new Promise((r) => app.on("exit", r));
}

process.on("SIGINT", () => { stop(); process.exit(0); });
process.on("SIGTERM", () => { stop(); process.exit(0); });
main().catch((e) => { console.error(e.message ?? e); }).finally(stop);
