import type { NextConfig } from "next";
import { securityHeaders } from "./src/server/security/headers";

const nextConfig: NextConfig = {
  // The integration harness (scripts/integration-test.mjs) builds into its own folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Do not advertise the framework in a response header.
  poweredByHeader: false,
  experimental: {
    // Image/document uploads go through server actions (max 10 MB document + form overhead).
    serverActions: { bodySizeLimit: "11mb" },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({ supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, dev: process.env.NODE_ENV !== "production" }),
      },
    ];
  },
};

export default nextConfig;