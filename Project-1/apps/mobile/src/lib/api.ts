/**
 * Thin client for the NationX REST API (/api/v1). All business rules, validation and authorisation live on
 * the server; this only sends requests, unwraps the standard envelope and maps failures to ApiError.
 */
export type ApiErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "NETWORK"
  | "TIMEOUT"
  | "BAD_RESPONSE";

export interface FieldIssue {
  field: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly status = 0,
    public readonly details: FieldIssue[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
  /** Worth offering "Try again" (connectivity, timeouts, server trouble, throttling). */
  get retryable(): boolean {
    return this.code === "NETWORK" || this.code === "TIMEOUT" || this.code === "INTERNAL_ERROR" || this.code === "RATE_LIMITED";
  }
  /** First server message for a form field, if any. */
  fieldMessage(field: string): string | undefined {
    return this.details.find((d) => d.field === field)?.message;
  }
}

const KNOWN: readonly string[] = ["VALIDATION_FAILED", "UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "RATE_LIMITED", "INTERNAL_ERROR"];

export interface ApiClientOptions {
  baseUrl: string;
  /** Returns the current access token, or null when signed out. Public endpoints work without one. */
  getToken: () => Promise<string | null>;
  /** Called when the server says the token is no longer valid (401 with a token attached). */
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface RequestOptions {
  query?: Record<string, string | number | undefined | null>;
  json?: unknown;
  form?: FormData;
  /** Do not attach the user's token (anonymous public reads). */
  anonymous?: boolean;
  signal?: AbortSignal;
}

export function buildQuery(query: RequestOptions["query"]): string {
  if (!query) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export function createApiClient(opts: ApiClientOptions) {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 15000;

  async function once<T>(method: string, path: string, o: RequestOptions): Promise<T> {
    const token = o.anonymous ? null : await opts.getToken();
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    o.signal?.addEventListener("abort", () => controller.abort());

    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    let body: BodyInit | undefined;
    if (o.form) body = o.form; // fetch sets the multipart boundary itself
    else if (o.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(o.json);
    }

    let res: Response;
    try {
      res = await doFetch(`${opts.baseUrl}/api/v1${path}${buildQuery(o.query)}`, { method, headers, body, signal: controller.signal });
    } catch {
      if (o.signal?.aborted && !timedOut) throw new ApiError("NETWORK", "Request cancelled");
      throw timedOut
        ? new ApiError("TIMEOUT", "The server took too long to respond. Please try again.")
        : new ApiError("NETWORK", "You appear to be offline. Check your connection and try again.");
    } finally {
      clearTimeout(timer);
    }

    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      /* not JSON */
    }
    const env = payload as { success?: boolean; data?: T; error?: { code?: string; message?: string; details?: FieldIssue[] } } | null;

    if (env?.success === true && res.ok) return env.data as T;
    if (env?.success === false && env.error) {
      const code = KNOWN.includes(env.error.code ?? "") ? (env.error.code as ApiErrorCode) : "INTERNAL_ERROR";
      if (res.status === 401 && token) opts.onUnauthorized?.();
      throw new ApiError(code, env.error.message || "Something went wrong", res.status, env.error.details ?? []);
    }
    throw new ApiError(res.status >= 500 ? "INTERNAL_ERROR" : "BAD_RESPONSE", "The server sent an unexpected response", res.status);
  }

  async function request<T>(method: string, path: string, o: RequestOptions = {}): Promise<T> {
    try {
      return await once<T>(method, path, o);
    } catch (e) {
      // One quick retry for idempotent reads that failed on the network; writes are never retried silently.
      if (method === "GET" && e instanceof ApiError && (e.code === "NETWORK" || e.code === "TIMEOUT") && !o.signal?.aborted) {
        return once<T>(method, path, o);
      }
      throw e;
    }
  }

  return {
    get: <T>(path: string, o?: RequestOptions) => request<T>("GET", path, o),
    post: <T>(path: string, o?: RequestOptions) => request<T>("POST", path, o),
    patch: <T>(path: string, o?: RequestOptions) => request<T>("PATCH", path, o),
    delete: <T>(path: string, o?: RequestOptions) => request<T>("DELETE", path, o),
  };
}
export type ApiClient = ReturnType<typeof createApiClient>;