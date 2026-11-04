import { z } from "zod";
import { nonEmptyText, phoneSchema } from "./common";
import { preferredLanguageSchema } from "./enums";

/** Trim and lower-case first: mobile keyboards often append a trailing space. */
const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

/** bcrypt (used by Supabase Auth) ignores bytes beyond 72, so cap there. */
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be at most 72 characters");

export const signUpInput = z.object({
  full_name: nonEmptyText(120),
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  preferred_language: preferredLanguageSchema.default("en"),
});
export type SignUpInput = z.infer<typeof signUpInput>;

/** Sign-in does not re-apply strength rules: only presence is required. */
export const signInInput = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required").max(72),
});
export type SignInInput = z.infer<typeof signInInput>;

/**
 * Self-service profile edit. Intentionally excludes id, email (owned by auth),
 * is_active and roles: those cannot be changed by the user.
 */
export const updateProfileInput = z
  .object({
    full_name: nonEmptyText(120),
    phone: phoneSchema,
    preferred_language: preferredLanguageSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update" });
export type UpdateProfileInput = z.infer<typeof updateProfileInput>;

/** Row shape for public.profiles. */
export const profileSchema = z.object({
  id: z.uuid(),
  full_name: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  preferred_language: preferredLanguageSchema,
  is_active: z.boolean(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});
export type Profile = z.infer<typeof profileSchema>;
