import { DEFAULT_PAGE_SIZE } from "@/server/validation/discovery";

export interface SearchView {
  q?: string | undefined;
  category?: string | undefined;
  locality?: string | undefined;
  model?: string | undefined;
  sort?: string | undefined;
  page?: number | undefined;
}

/** Build a listing URL, omitting empty values and defaults so URLs stay short and shareable. */
export function buildListingHref(basePath: string, view: SearchView): string {
  const params = new URLSearchParams();
  if (view.q) params.set("q", view.q);
  if (view.category) params.set("category", view.category);
  if (view.locality) params.set("locality", view.locality);
  if (view.model) params.set("model", view.model);
  if (view.sort && view.sort !== "relevance") params.set("sort", view.sort);
  if (view.page && view.page > 1) params.set("page", String(view.page));
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/** First value of a Next.js searchParams entry (it may be string | string[] | undefined). */
export function firstParam(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v === undefined || v.trim() === "" ? undefined : v;
}

/** 1-based page number from a query string; anything invalid becomes page 1. Capped to keep offsets sane. */
export function parsePage(value: string | string[] | undefined): number {
  const n = Number(firstParam(value));
  return Number.isInteger(n) && n >= 1 && n <= 500 ? n : 1;
}

export function pageToOffset(page: number, pageSize = DEFAULT_PAGE_SIZE): number {
  return (Math.max(page, 1) - 1) * pageSize;
}

export function totalPages(total: number, pageSize = DEFAULT_PAGE_SIZE): number {
  return Math.max(Math.ceil(total / pageSize), 1);
}

/**
 * "Back to results" targets must be listing pages on this site. Anything else
 * (external URLs, protocol-relative, other app routes) is ignored, which keeps
 * the `from` query parameter from becoming an open redirect or link injection.
 */
export function safeBackHref(raw: string | string[] | undefined): string | null {
  const v = firstParam(raw);
  if (!v || v.length > 300 || !v.startsWith("/") || v.startsWith("//") || v.includes("\\")) return null;
  const path = v.split("?")[0] ?? "";
  const allowed = path === "/" || path === "/search" || path === "/explore" || /^\/(category|locality)\/[a-z0-9-]+$/.test(path);
  return allowed ? v : null;
}
