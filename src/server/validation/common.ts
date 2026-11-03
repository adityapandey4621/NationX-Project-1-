import { z } from "zod";

/** Primary keys are UUIDs everywhere (docs/DATABASE_SCHEMA.md). */
export const uuidSchema = z.uuid();

/** [PROPOSED] Indian mobile number in E.164 form, e.g. +919876543210. */
export const phoneSchema = z
  .string()
  .regex(/^\+91[6-9]\d{9}$/, "Enter a valid Indian mobile number in +91XXXXXXXXXX format");

/** Indian PIN code: six digits, first digit 1-9. Telangana is 50xxxx; Khammam 507xxx. */
export const pincodeSchema = z.string().regex(/^[1-9][0-9]{5}$/, "Enter a valid 6-digit PIN code");

/** Lower-case kebab-case slug, used for localities, categories and storefronts. */
export const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase kebab-case");

/** Postgres TIMESTAMPTZ as returned by PostgREST (ISO 8601 with offset). */
export const timestampSchema = z.iso.datetime({ offset: true });

/** Postgres TIME as returned by PostgREST: HH:MM or HH:MM:SS. */
export const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/);

export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);

export const nonEmptyText = (max = 500) => z.string().trim().min(1).max(max);
