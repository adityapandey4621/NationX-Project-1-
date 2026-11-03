import "react-native-url-polyfill/auto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { AppState } from "react-native";
import { appConfig } from "../config";
import { createChunkedStorage } from "./secure-storage";

let client: SupabaseClient | null = null;

/**
 * Supabase Auth client - the SAME identity system as the website. Used for sign-up, sign-in, sign-out and token
 * refresh only; data and business actions go through /api/v1. Tokens are persisted in the OS keystore.
 */
export function getSupabase(): SupabaseClient {
  if (client) return client;
  const cfg = appConfig();
  client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: {
      storage: createChunkedStorage(SecureStore),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  // Refresh tokens only while the app is in the foreground (saves battery and avoids background failures).
  AppState.addEventListener("change", (state) => {
    if (!client) return;
    if (state === "active") void client.auth.startAutoRefresh();
    else void client.auth.stopAutoRefresh();
  });
  return client;
}