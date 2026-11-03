import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ServiceError, type ServiceErrorCode } from "./services/service-result";

/** Response envelope from docs/API_CONTRACTS.md §1.2. */
export type ApiErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

const STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

const FROM_SERVICE: Record<ServiceErrorCode, ApiErrorCode> = {
  VALIDATION_ERROR: "VALIDATION_FAILED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  FORBIDDEN: "FORBIDDEN",
  RATE_LIMITED: "RATE_LIMITED",
  DATABASE_ERROR: "INTERNAL_ERROR",
};

function meta() {
  return { timestamp: new Date().toISOString(), requestId: `req_${crypto.randomUUID()}` };
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data, meta: meta() }, { status });
}

export function errorResponse(
  code: ApiErrorCode,
  message: string,
  options: { status?: number; details?: { field: string; message: string }[] } = {},
) {
  return NextResponse.json(
    { success: false, error: { code, message, ...(options.details ? { details: options.details } : {}) }, meta: meta() },
    { status: options.status ?? STATUS[code] },
  );
}

/** Converts thrown errors into the envelope without leaking internals. */
export function handleRouteError(e: unknown) {
  if (e instanceof ZodError) {
    return errorResponse("VALIDATION_FAILED", "The submitted data contains invalid fields.", {
      details: e.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
  }
  if (e instanceof ServiceError) {
    const code = FROM_SERVICE[e.code];
    return errorResponse(code, code === "INTERNAL_ERROR" ? "Internal error" : e.message);
  }
  console.error("Unhandled route error", e);
  return errorResponse("INTERNAL_ERROR", "Internal error");
}

/** Parse a JSON body; non-JSON becomes `null` so schema validation reports it. */
export async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}
