import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type {
  Application, Homepage, HelpRequest, Me, MyBusiness, Page, Product, ProductResult, ShopResult, StorefrontView, Taxonomy, TrackedRequest,
} from "../lib/types";

/** Keys starting with "public" hold only anonymous-readable data and are the only ones persisted to disk. */
export const keys = {
  taxonomy: ["public", "taxonomy"] as const,
  home: (locality?: string) => ["public", "home", locality ?? "all"] as const,
  search: (p: object) => ["public", "search", p] as const,
  items: (p: object) => ["public", "items", p] as const,
  shop: (slug: string) => ["public", "shop", slug] as const,
  me: ["me"] as const,
  requests: ["requests"] as const,
  applications: ["merchant", "applications"] as const,
  businesses: ["merchant", "businesses"] as const,
  products: (shopId: string) => ["merchant", "products", shopId] as const,
};

export const useTaxonomy = () =>
  useQuery({ queryKey: keys.taxonomy, queryFn: () => api().get<Taxonomy>("/taxonomy", { anonymous: true }), staleTime: 6 * 60 * 60 * 1000 });

export const useHomepage = (localityId?: string) =>
  useQuery({
    queryKey: keys.home(localityId),
    queryFn: () => api().get<Homepage>("/discovery/homepage", { anonymous: true, query: { localityId } }),
    staleTime: 2 * 60 * 1000,
    placeholderData: keepPreviousData,
  });

export interface SearchParams { q?: string; categoryId?: string; localityId?: string; model?: string; sort?: string }
const PAGE = 12;

export function useShopSearch(p: SearchParams, enabled = true) {
  return useInfiniteQuery({
    queryKey: keys.search(p),
    enabled,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      api().get<Page<ShopResult>>("/discovery/search", { anonymous: true, signal, query: { ...p, limit: PAGE, offset: pageParam } }),
    getNextPageParam: (last) => (last.offset + last.results.length < last.total ? last.offset + PAGE : undefined),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

/** Item results are a short "top matches" list; it needs a text query. */
export const useItemSearch = (q: string, p: { categoryId?: string; localityId?: string }) =>
  useQuery({
    queryKey: keys.items({ q, ...p }),
    enabled: q.trim().length > 0,
    queryFn: ({ signal }) => api().get<Page<ProductResult>>("/discovery/products", { anonymous: true, signal, query: { q, ...p, limit: 6 } }),
    staleTime: 60 * 1000,
  });

export const useStorefront = (slug: string) =>
  useQuery({
    queryKey: keys.shop(slug),
    queryFn: ({ signal }) => api().get<StorefrontView>(`/storefronts/${encodeURIComponent(slug)}`, { anonymous: true, signal }),
    staleTime: 60 * 1000,
    retry: (count, e) => (e as { retryable?: boolean }).retryable === true && count < 2,
  });

export const useMe = (enabled: boolean) => useQuery({ queryKey: keys.me, enabled, queryFn: () => api().get<Me>("/me"), staleTime: 5 * 60 * 1000 });

export const useMyRequests = (enabled: boolean) =>
  useQuery({ queryKey: keys.requests, enabled, queryFn: () => api().get<{ requests: HelpRequest[] }>("/help-me-find-it").then((d) => d.requests) });

export const useMyApplications = (enabled: boolean) =>
  useQuery({ queryKey: keys.applications, enabled, queryFn: () => api().get<{ applications: Application[] }>("/merchant/applications").then((d) => d.applications) });

export const useMyBusinesses = (enabled: boolean) =>
  useQuery({ queryKey: keys.businesses, enabled, queryFn: () => api().get<{ businesses: MyBusiness[] }>("/merchant/shops").then((d) => d.businesses) });

export const useShopProducts = (shopId: string, enabled = true) =>
  useQuery({ queryKey: keys.products(shopId), enabled, queryFn: () => api().get<{ products: Product[] }>(`/merchant/shops/${shopId}/products`).then((d) => d.products) });

export interface HelpRequestBody {
  item_name: string;
  item_description?: string;
  preferred_locality_id: string;
  category_id?: string;
  contact_name: string;
  contact_phone: string;
  contact_email?: string;
  consent_given: true;
}
export const useSubmitHelpRequest = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: HelpRequestBody) => api().post<{ tracking_id: string; status: string; message: string }>("/help-me-find-it", { json: body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.requests }),
  });
};
export const useTrackRequest = () =>
  useMutation({ mutationFn: (body: { tracking_id: string; contact_phone: string }) => api().post<TrackedRequest>("/help-me-find-it/track", { json: body, anonymous: true }) });
export const useCancelRequest = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api().post(`/help-me-find-it/${id}/cancel`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.requests }),
  });
};
export const useUpdateProfile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { full_name?: string; phone?: string }) => api().patch("/me", { json: body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.me }),
  });
};