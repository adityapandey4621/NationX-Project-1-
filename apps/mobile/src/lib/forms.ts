import { normalizeIndianPhone } from "./format";

/**
 * Immediate-feedback checks only. The server re-validates everything and is the authority; these exist so a
 * person on a slow connection sees an obvious typo before a round trip. No business rules live here.
 */
export type FieldErrors<K extends string> = Partial<Record<K, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function checkSignUp(v: { full_name: string; email: string; phone: string; password: string }) {
  const errors: FieldErrors<"full_name" | "email" | "phone" | "password"> = {};
  if (!v.full_name.trim()) errors.full_name = "Enter your name";
  if (!EMAIL.test(v.email.trim())) errors.email = "Enter a valid email address";
  if (!normalizeIndianPhone(v.phone)) errors.phone = "Enter a valid 10-digit Indian mobile number";
  if (v.password.length < 8) errors.password = "Password must be at least 8 characters";
  else if (v.password.length > 72) errors.password = "Password must be at most 72 characters";
  return errors;
}

export function checkSignIn(v: { email: string; password: string }) {
  const errors: FieldErrors<"email" | "password"> = {};
  if (!EMAIL.test(v.email.trim())) errors.email = "Enter a valid email address";
  if (!v.password) errors.password = "Enter your password";
  return errors;
}

export function checkHelpRequest(v: { item_name: string; contact_name: string; contact_phone: string; locality_id: string; consent: boolean }) {
  const errors: FieldErrors<"item_name" | "contact_name" | "contact_phone" | "locality_id" | "consent"> = {};
  if (v.item_name.trim().length < 2) errors.item_name = "Tell us what you are looking for";
  if (!v.contact_name.trim()) errors.contact_name = "Enter your name";
  if (!normalizeIndianPhone(v.contact_phone)) errors.contact_phone = "Enter a valid 10-digit Indian mobile number";
  if (!v.locality_id) errors.locality_id = "Choose your area";
  if (!v.consent) errors.consent = "Please agree to be contacted about this request";
  return errors;
}

export const hasErrors = (e: object): boolean => Object.keys(e).length > 0;