#!/usr/bin/env node
// One-time administrator bootstrap.
//   npm run bootstrap:admin -- you@example.com
// The account must already exist (sign up through the app first). The database
// function refuses to run once any administrator exists, and is callable only
// with the service-role key, which is read from the environment (.env.local) —
// never hardcoded and never sent to a browser.
import { createClient } from "@supabase/supabase-js";

const email = process.argv[2];
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!email || !email.includes("@")) {
  console.error("Usage: npm run bootstrap:admin -- <email-of-existing-account>");
  process.exit(2);
}
if (!url || !serviceKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.example).");
  process.exit(2);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await db.rpc("bootstrap_first_admin", { p_email: email });
if (error) {
  console.error(`Bootstrap failed: ${error.message}`);
  process.exit(1);
}
console.log(`Administrator role granted to user ${data}.`);
