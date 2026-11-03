import { z } from "zod";

/**
 * Value sets mirror the CHECK constraints in
 * supabase/migrations/001_initial_schema.sql. Keep both in sync.
 */

export const USER_ROLES = ["customer", "merchant", "admin", "operator"] as const;
export const userRoleSchema = z.enum(USER_ROLES);
export type UserRole = z.infer<typeof userRoleSchema>;

export const PREFERRED_LANGUAGES = ["en", "te"] as const;
export const preferredLanguageSchema = z.enum(PREFERRED_LANGUAGES);

export const OPERATING_MODELS = [
  "delivery",
  "pickup",
  "visit_only",
  "appointment",
  "quotation",
] as const;
export const operatingModelSchema = z.enum(OPERATING_MODELS);
export type OperatingModel = z.infer<typeof operatingModelSchema>;

export const APPLICATION_STATUSES = [
  "draft",
  "submitted",
  "correction_requested",
  "approved",
  "rejected",
  "suspended",
] as const;
export const applicationStatusSchema = z.enum(APPLICATION_STATUSES);
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;

export const BUSINESS_MEMBER_ROLES = ["owner", "manager", "employee"] as const;
export const businessMemberRoleSchema = z.enum(BUSINESS_MEMBER_ROLES);

export const STOREFRONT_TEMPLATES = [
  "standard_retail",
  "grocery",
  "service_provider",
  "artisan",
] as const;
export const storefrontTemplateSchema = z.enum(STOREFRONT_TEMPLATES);

export const VISIBILITY_STATUSES = ["visible", "hidden", "suspended"] as const;
export const visibilityStatusSchema = z.enum(VISIBILITY_STATUSES);

export const STOREFRONT_ACTIONS = [
  "call",
  "whatsapp",
  "directions",
  "appointment",
  "inquiry",
  "order",
] as const;
export const storefrontActionSchema = z.enum(STOREFRONT_ACTIONS);

export const STOCK_STATUSES = ["in_stock", "call_to_confirm", "out_of_stock"] as const;
export const stockStatusSchema = z.enum(STOCK_STATUSES);

export const HMF_STATUSES = [
  "pending",
  "under_review",
  "matched",
  "unresolved",
  "cancelled",
] as const;
export const hmfStatusSchema = z.enum(HMF_STATUSES);
