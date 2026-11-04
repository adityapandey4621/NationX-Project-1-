import { appConfig } from "../config";
import { createApiClient, type ApiClient } from "../lib/api";
import { getAccessToken, signOut } from "../lib/auth";

let instance: ApiClient | null = null;

/** The single API client. A 401 on an authenticated call means the session is dead: sign out locally. */
export function api(): ApiClient {
  instance ??= createApiClient({
    baseUrl: appConfig().apiUrl,
    getToken: getAccessToken,
    onUnauthorized: () => void signOut().catch(() => undefined),
  });
  return instance;
}