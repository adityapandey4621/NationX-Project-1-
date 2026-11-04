import { z } from "zod";
import { latitudeSchema, longitudeSchema, pincodeSchema } from "./common";
import { localitySchema } from "./taxonomy";

/** Row shape for public.pincodes (India Post directory, imported). */
export const pincodeOfficeSchema = z.object({
  pincode: pincodeSchema,
  office_name: z.string(),
  district: z.string(),
  state: z.string(),
});
export type PincodeOffice = z.infer<typeof pincodeOfficeSchema>;

/** Result of resolving a PIN code: place names plus NationX localities that use it. */
export const pincodeLookupSchema = z.object({
  pincode: pincodeSchema,
  district: z.string(),
  state: z.string(),
  offices: z.array(z.string()),
  localities: z.array(localitySchema),
});
export type PincodeLookup = z.infer<typeof pincodeLookupSchema>;

export const nearestPincodeSchema = pincodeOfficeSchema.extend({ distance_km: z.number() });
export type NearestPincode = z.infer<typeof nearestPincodeSchema>;

/** Query for GPS-based suggestions. Coordinates are used transiently, never stored by this call. */
export const nearestQueryInput = z.object({
  lat: z.coerce.number().pipe(latitudeSchema),
  lng: z.coerce.number().pipe(longitudeSchema),
});
