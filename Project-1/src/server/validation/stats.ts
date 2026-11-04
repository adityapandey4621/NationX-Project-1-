import { z } from "zod";
import { slugSchema } from "./common";

export const TRACK_ACTIONS = ["view", "call", "whatsapp", "directions"] as const;
export const trackInput = z.object({ action: z.enum(TRACK_ACTIONS) });
export type TrackAction = z.infer<typeof trackInput>["action"];

export const statsRowSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  views: z.coerce.number().int().nonnegative(),
  calls: z.coerce.number().int().nonnegative(),
  whatsapp: z.coerce.number().int().nonnegative(),
  directions: z.coerce.number().int().nonnegative(),
});
export type StatsRow = z.infer<typeof statsRowSchema>;
export const trackSlug = slugSchema;