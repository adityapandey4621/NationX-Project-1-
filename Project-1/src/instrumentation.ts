import { describeRequestError } from "./server/observability";

/** Next.js calls this for every unhandled server error (render, route handler, server action). See src/server/observability.ts. */
export function onRequestError(
  err: unknown,
  request: { method?: string },
  context: { routePath?: string; routeType?: string; renderSource?: string },
): void {
  console.error(JSON.stringify(describeRequestError(err, request, context)));
}
