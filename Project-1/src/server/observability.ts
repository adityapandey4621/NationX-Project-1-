/**
 * One machine-readable log line for a failed server request, for log drains and alert rules.
 *
 * Deliberately contains NO personal data: not the URL (query strings can hold phone numbers and tracking IDs), not headers or cookies,
 * and not the error message (database errors can quote row values). Only the route PATTERN (`/shop/[slug]`), the error class and
 * Next's `digest`, which also appears next to the full error in the host's own log, so an operator can join the two.
 */
export interface RequestErrorLine {
  level: "error";
  event: "request_error";
  time: string;
  digest: string | null;
  error: string;
  method: string;
  route: string;
  route_type: string;
  render_source: string | null;
}

export function describeRequestError(
  err: unknown,
  request: { method?: string },
  context: { routePath?: string; routeType?: string; renderSource?: string },
  now: Date = new Date(),
): RequestErrorLine {
  const e = (typeof err === "object" && err !== null ? err : {}) as { digest?: unknown; name?: unknown };
  const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[^\w .:/\[\]()-]/g, "?").slice(0, max) : null);
  return {
    level: "error",
    event: "request_error",
    time: now.toISOString(),
    digest: clean(e.digest, 64),
    error: clean(e.name, 60) ?? "Error",
    method: clean(request.method, 10) ?? "?",
    route: clean(context.routePath, 200) ?? "?",
    route_type: clean(context.routeType, 30) ?? "?",
    render_source: clean(context.renderSource, 40),
  };
}
