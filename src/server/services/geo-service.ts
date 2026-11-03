import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  localitySchema,
  nearestPincodeSchema,
  pincodeOfficeSchema,
  pincodeSchema,
  latitudeSchema,
  longitudeSchema,
  type NearestPincode,
  type PincodeLookup,
} from "../validation";
import { fromPostgrest } from "./service-result";

/**
 * Resolve a PIN code to its district/state (from the imported India Post
 * directory) and to the NationX localities that use it. Returns null when the
 * code is unknown — callers fall back to manual locality selection.
 */
export async function lookupPincode(db: SupabaseClient, pincode: string): Promise<PincodeLookup | null> {
  const parsed = pincodeSchema.safeParse(pincode);
  if (!parsed.success) return null;

  const [offices, localities] = await Promise.all([
    db.from("pincodes").select("pincode, office_name, district, state").eq("pincode", parsed.data).order("office_name"),
    db.from("localities").select("*").eq("pincode", parsed.data).eq("is_active", true).order("name"),
  ]);
  if (offices.error) throw fromPostgrest(offices.error, "lookupPincode.offices");
  if (localities.error) throw fromPostgrest(localities.error, "lookupPincode.localities");

  const officeRows = z.array(pincodeOfficeSchema).parse(offices.data);
  const localityRows = z.array(localitySchema).parse(localities.data);
  const place = officeRows[0] ?? localityRows[0];
  if (!place) return null;

  return {
    pincode: parsed.data,
    district: place.district,
    state: "state" in place ? place.state : "",
    offices: officeRows.map((o) => o.office_name),
    localities: localityRows,
  };
}

/**
 * Suggest PIN codes near a GPS point (device location the user chose to share).
 * Coordinates are used for this query only and are not stored or logged.
 */
export async function nearestPincodes(db: SupabaseClient, lat: number, lng: number, limit = 3): Promise<NearestPincode[]> {
  const la = latitudeSchema.parse(lat);
  const lo = longitudeSchema.parse(lng);
  const { data, error } = await db.rpc("nearest_pincodes", { p_lat: la, p_lng: lo, p_limit: limit });
  if (error) throw fromPostgrest(error, "nearestPincodes");
  return z.array(nearestPincodeSchema).parse(data);
}
