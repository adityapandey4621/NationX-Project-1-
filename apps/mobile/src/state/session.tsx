import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { keys, useMe } from "../api/queries";
import { signOut as authSignOut } from "../lib/auth";
import { getSupabase } from "../lib/supabase";
import type { Me } from "../lib/types";

export type SessionState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; userId: string; email: string | null; me: Me | null; meLoading: boolean; meError: Error | null; reloadMe: () => void };

interface Ctx {
  state: SessionState;
  signOut: () => Promise<void>;
}
const SessionContext = createContext<Ctx | null>(null);

/**
 * Mirrors the Supabase Auth session (persisted in the OS keystore) and loads the account's profile and roles
 * from GET /api/v1/me. Roles come from the server's user_roles table - never from the token or the device.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    const supabase = getSupabase();
    let alive = true;
    void supabase.auth.getSession().then(({ data }) => alive && setSession((prev) => (prev === undefined ? data.session : prev)));
    // Keep this callback synchronous: awaiting Supabase calls inside it can deadlock the auth client.
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) qc.clear(); // private data (profile, requests, shop data) must not outlive the session
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, [qc]);

  const signedIn = !!session;
  const meQuery = useMe(signedIn);
  const reloadMe = useCallback(() => void qc.invalidateQueries({ queryKey: keys.me }), [qc]);

  const state = useMemo<SessionState>(() => {
    if (session === undefined) return { status: "loading" };
    if (!session) return { status: "signedOut" };
    return {
      status: "signedIn",
      userId: session.user.id,
      email: session.user.email ?? null,
      me: meQuery.data ?? null,
      meLoading: meQuery.isLoading,
      meError: meQuery.error,
      reloadMe,
    };
  }, [session, meQuery.data, meQuery.isLoading, meQuery.error, reloadMe]);

  const signOut = useCallback(async () => {
    await authSignOut();
    qc.clear();
  }, [qc]);

  const value = useMemo(() => ({ state, signOut }), [state, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Ctx {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}