import type { PostgrestError } from "@supabase/supabase-js";

export type ServiceErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "DATABASE_ERROR";

/** Domain-level error. Route handlers map `code` to an HTTP status. */
export class ServiceError extends Error {
  constructor(
    public readonly code: ServiceErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

/**
 * Maps database errors to domain errors. The workflow functions in migration
 * 004 raise deliberate, user-safe messages with these SQLSTATEs:
 *   42501 insufficient_privilege · P0002 no_data_found · 55000 wrong state ·
 *   23514 check_violation · 23505 unique_violation · 54000 program_limit_exceeded
 */
export function fromPostgrest(error: PostgrestError, context: string): ServiceError {
  switch (error.code) {
    case "23505":
      return new ServiceError("CONFLICT", error.message.startsWith("slug ") ? error.message : "That record already exists", error);
    case "55000":
      return new ServiceError("CONFLICT", error.message, error);
    case "42501":
      return new ServiceError("FORBIDDEN", "You are not permitted to do that", error);
    case "P0002": // PL/pgSQL `no_data_found`, raised by the workflow functions
    case "02000": // SQL `no_data`
    case "PGRST116":
      return new ServiceError("NOT_FOUND", "Not found", error);
    case "23514":
      return new ServiceError("VALIDATION_ERROR", error.message, error);
    case "54000": // program_limit_exceeded: the throttle in submit_help_request
      return new ServiceError("RATE_LIMITED", error.message, error);
    default:
      return new ServiceError("DATABASE_ERROR", `${context}: ${error.message}`, error);
  }
}
