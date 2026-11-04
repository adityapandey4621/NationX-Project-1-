import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readConfig } from "../src/config";

const good = { EXPO_PUBLIC_API_URL: "https://api.nationx.test/", EXPO_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", EXPO_PUBLIC_SUPABASE_ANON_KEY: "anon.jwt.value" };

describe("readConfig", () => {
  it("accepts valid https settings and strips trailing slashes", () => {
    const r = readConfig(good, false);
    expect(r).toEqual({ ok: true, config: { apiUrl: "https://api.nationx.test", supabaseUrl: "https://abc.supabase.co", supabaseAnonKey: "anon.jwt.value", webUrl: "https://api.nationx.test" } });
  });
  it("uses a separate web URL when given", () => {
    const r = readConfig({ ...good, EXPO_PUBLIC_WEB_URL: "https://nationx.in" }, false);
    expect(r.ok && r.config.webUrl).toBe("https://nationx.in");
  });
  it("reports every missing value", () => {
    const r = readConfig({}, false);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problems).toHaveLength(3);
  });
  it("rejects the .env.example placeholders", () => {
    const r = readConfig({ ...good, EXPO_PUBLIC_SUPABASE_URL: "https://your-project-id.supabase.co", EXPO_PUBLIC_SUPABASE_ANON_KEY: "your-supabase-anon-key" }, false);
    expect(!r.ok && r.problems.join(" ")).toMatch(/placeholder/);
  });
  it("allows plain http only in development builds", () => {
    const env = { ...good, EXPO_PUBLIC_API_URL: "http://10.0.2.2:3000" };
    expect(readConfig(env, true).ok).toBe(true);
    const prod = readConfig(env, false);
    expect(!prod.ok && prod.problems.join(" ")).toMatch(/https/);
  });
  it("rejects malformed URLs", () => {
    expect(readConfig({ ...good, EXPO_PUBLIC_API_URL: "not a url" }, true).ok).toBe(false);
  });
});

describe("secrets", () => {
  it("the app source never references the service-role key", () => {
    const files = ["src/config.ts", "src/lib/supabase.ts", "src/lib/auth.ts", "src/api/client.ts", ".env.example"];
    for (const f of files) {
      const text = readFileSync(join(__dirname, "..", f), "utf8");
      // allowed only in the explanatory comment of .env.example / config.ts
      const code = text.split("\n").filter((l: string) => !l.trim().startsWith("#") && !l.trim().startsWith("*") && !l.trim().startsWith("//") && !l.trim().startsWith("/*"));
      expect(code.join("\n")).not.toMatch(/SERVICE_ROLE|service_role/i);
    }
  });
});