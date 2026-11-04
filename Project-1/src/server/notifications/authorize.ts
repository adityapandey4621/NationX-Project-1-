import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Checks `Authorization: Bearer <secret>` against the configured scheduler secret in constant time.
 * Both sides are hashed first so neither the secret's length nor any prefix leaks through timing.
 * A missing/short secret never authorises anyone: an unset CRON_SECRET must not become an open door.
 */
export function isAuthorizedScheduler(authorizationHeader: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16) return false;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader ?? "");
  if (!match?.[1]) return false;
  const a = createHash("sha256").update(match[1]).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}
