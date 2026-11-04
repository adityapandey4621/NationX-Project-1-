#!/usr/bin/env node
// Import the India Post PIN code directory into public.pincodes.
//
//   npm run import:pincodes -- <path-to-csv> [--state TELANGANA]
//
// Source: "All India Pincode Directory" published by India Post on
// data.gov.in under the Government Open Data License (download it yourself;
// this repo does not bundle or invent location data). Expected columns
// (case-insensitive): officename, pincode, district, statename, and optionally
// latitude, longitude (values like "NA" are treated as missing).
//
// Run with the service-role key in .env.local. Safe to re-run (upserts).
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const stateIdx = args.indexOf("--state");
const stateFilter = stateIdx !== -1 ? args[stateIdx + 1]?.toUpperCase() : "TELANGANA";

if (!file) {
  console.error("Usage: npm run import:pincodes -- <csv-file> [--state TELANGANA]");
  process.exit(2);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.example).");
  process.exit(2);
}

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF). */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const [header, ...records] = parseCsv(readFileSync(file, "utf8").replace(/^﻿/, ""));
const col = Object.fromEntries(header.map((h, i) => [h.trim().toLowerCase(), i]));
for (const needed of ["officename", "pincode", "district", "statename"]) {
  if (!(needed in col)) {
    console.error(`Missing required column "${needed}". Found: ${header.join(", ")}`);
    process.exit(2);
  }
}

const num = (v) => {
  const n = Number(v);
  return v && v.trim().toUpperCase() !== "NA" && Number.isFinite(n) ? n : null;
};
// Official coordinates for India lie within roughly lat 6–38, lng 68–98; anything else is a data error.
const inIndia = (lat, lng) => lat !== null && lng !== null && lat >= 6 && lat <= 38 && lng >= 68 && lng <= 98;

const seen = new Set();
const out = [];
for (const r of records) {
  const state = (r[col.statename] ?? "").trim();
  if (stateFilter && state.toUpperCase() !== stateFilter) continue;
  const pincode = (r[col.pincode] ?? "").trim();
  const office = (r[col.officename] ?? "").trim();
  if (!/^[1-9][0-9]{5}$/.test(pincode) || !office) continue;
  const k = `${pincode}|${office}`;
  if (seen.has(k)) continue;
  seen.add(k);
  const lat = "latitude" in col ? num(r[col.latitude]) : null;
  const lng = "longitude" in col ? num(r[col.longitude]) : null;
  const ok = inIndia(lat, lng);
  out.push({
    pincode, office_name: office, district: (r[col.district] ?? "").trim(), state,
    latitude: ok ? lat : null, longitude: ok ? lng : null,
  });
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
let done = 0;
for (let i = 0; i < out.length; i += 500) {
  const batch = out.slice(i, i + 500);
  const { error } = await db.from("pincodes").upsert(batch, { onConflict: "pincode,office_name" });
  if (error) {
    console.error(`Import failed after ${done} rows: ${error.message}`);
    process.exit(1);
  }
  done += batch.length;
}
console.log(`Imported ${done} post offices${stateFilter ? ` for ${stateFilter}` : ""} (${out.filter((o) => o.latitude !== null).length} with coordinates).`);
