import NetInfo from "@react-native-community/netinfo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { onlineManager, QueryClient } from "@tanstack/react-query";
import { ApiError } from "../lib/api";

/** Never retry a request the server has understood and refused (4xx); retry connectivity trouble twice. */
export function shouldRetry(count: number, error: unknown): boolean {
  if (error instanceof ApiError && !error.retryable) return false;
  return count < 2;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: shouldRetry, gcTime: 24 * 60 * 60 * 1000, refetchOnWindowFocus: false, networkMode: "offlineFirst" },
    mutations: { retry: false, networkMode: "online" },
  },
});

// React Query pauses/resumes with real connectivity.
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((s) => setOnline(s.isConnected !== false && s.isInternetReachable !== false)),
);

export const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: "nationx-public-cache", throttleTime: 2000 });

/**
 * Only anonymous-readable discovery data is written to disk (so Home/Search work offline). Profile, requests
 * and merchant data are held in memory only and cleared on sign-out.
 */
export function shouldPersist(queryKey: readonly unknown[], status: string): boolean {
  return status === "success" && queryKey[0] === "public";
}