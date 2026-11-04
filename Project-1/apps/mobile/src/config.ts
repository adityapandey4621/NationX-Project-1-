/**
 * Public runtime configuration. Only EXPO_PUBLIC_* values exist in the app bundle, and anything there is
 * readable by whoever unpacks the app - so this file never reads a secret. The Supabase anon key is public
 * by design (row-level security protects the data); the service-role key must never be added here.
 */
export interface AppConfig {
  apiUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  webUrl: string;
}

export type ConfigResult = { ok: true; config: AppConfig } | { ok: false; problems: string[] };

type Env = Record<string, string | undefined>;

const isPlaceholder = (v: string) => /your-|example\.com|<.*>/i.test(v);

function cleanUrl(raw: string | undefined, name: string, problems: string[], allowHttp: boolean): string {
  const v = (raw ?? "").trim().replace(/\/+$/, "");
  if (!v) {
    problems.push(`${name} is not set`);
    return "";
  }
  if (isPlaceholder(v)) {
    problems.push(`${name} still has the placeholder value`);
    return "";
  }
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    problems.push(`${name} is not a valid URL`);
    return "";
  }
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
    problems.push(`${name} must use https`);
    return "";
  }
  return v;
}

/** Pure so it can be unit-tested; `allowHttp` is true only in development builds (local backend). */
export function readConfig(env: Env, allowHttp: boolean): ConfigResult {
  const problems: string[] = [];
  const apiUrl = cleanUrl(env.EXPO_PUBLIC_API_URL, "EXPO_PUBLIC_API_URL", problems, allowHttp);
  const supabaseUrl = cleanUrl(env.EXPO_PUBLIC_SUPABASE_URL, "EXPO_PUBLIC_SUPABASE_URL", problems, allowHttp);
  const supabaseAnonKey = (env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  if (!supabaseAnonKey || isPlaceholder(supabaseAnonKey)) problems.push("EXPO_PUBLIC_SUPABASE_ANON_KEY is not set");
  const webRaw = (env.EXPO_PUBLIC_WEB_URL ?? "").trim();
  const webUrl = webRaw ? cleanUrl(webRaw, "EXPO_PUBLIC_WEB_URL", problems, allowHttp) : apiUrl;
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, config: { apiUrl, supabaseUrl, supabaseAnonKey, webUrl } };
}

// Expo inlines process.env.EXPO_PUBLIC_X only for literal property access, so each one is spelled out.
export const configResult: ConfigResult = readConfig(
  {
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    EXPO_PUBLIC_WEB_URL: process.env.EXPO_PUBLIC_WEB_URL,
  },
  __DEV__,
);

/** Only call after the root layout has confirmed the configuration is valid. */
export function appConfig(): AppConfig {
  if (!configResult.ok) throw new Error("App is not configured");
  return configResult.config;
}