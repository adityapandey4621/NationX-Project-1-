import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/health - liveness for uptime monitors. `?deep=1` also checks that the database answers (a cheap public read of
 * the active localities through the API); it returns 503 when it does not. Reveals nothing but status and time.
 */
export async function GET(request: Request) {
  const body: { status: "ok" | "degraded"; time: string; database?: "ok" | "unreachable" | "not_configured" } = { status: "ok", time: new Date().toISOString() };
  if (new URL(request.url).searchParams.get("deep") === "1") {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      body.database = "not_configured";
      body.status = "degraded";
    } else {
      try {
        const res = await fetch(`${url}/rest/v1/localities?select=id&limit=1`, { headers: { apikey: key }, signal: AbortSignal.timeout(3000), cache: "no-store" });
        body.database = res.ok ? "ok" : "unreachable";
      } catch {
        body.database = "unreachable";
      }
      if (body.database !== "ok") body.status = "degraded";
    }
  }
  return NextResponse.json(body, { status: body.status === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}