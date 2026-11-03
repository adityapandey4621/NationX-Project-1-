"use client";

import { useState } from "react";
import { LocateFixed, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NEAR_COOKIE, NEAR_COOKIE_MAX_AGE_S } from "@/lib/constants";
import { serializeCoords } from "@/lib/geo";

type Phase = "idle" | "asking" | "denied" | "unavailable";

/**
 * Opt-in "Use my location". It only asks when tapped. The position is rounded to ~100 m,
 * kept in a 2-hour cookie on this device purely so the server can compute distances,
 * and is never written to the database. If it is refused, nothing breaks: the manual
 * area picker keeps working.
 */
export interface NearMeLabels {
  use: string;
  asking: string;
  hint: string;
  denied: string;
  unavailable: string;
  active: string;
  stop: string;
}

export function NearMe({ active, labels }: { active: boolean; labels: NearMeLabels }) {
  const [phase, setPhase] = useState<Phase>("idle");

  function setCookie(value: string, maxAge: number) {
    document.cookie = `${NEAR_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  }

  function ask() {
    if (!("geolocation" in navigator)) {
      setPhase("unavailable");
      return;
    }
    setPhase("asking");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCookie(serializeCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }), NEAR_COOKIE_MAX_AGE_S);
        // A full reload (not router.refresh) is deliberate: the soft refresh returned the new
        // page but did not repaint it in the production build, and this is a one-time action.
        window.location.reload();
      },
      (err) => setPhase(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  }

  function stop() {
    setCookie("", 0);
    window.location.reload();
  }

  if (active) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1 text-xs font-medium text-success">
          <LocateFixed aria-hidden className="size-3.5" /> {labels.active}
        </span>
        <button type="button" onClick={stop} className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
          <X aria-hidden className="size-3" /> {labels.stop}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Button type="button" variant="outline" size="sm" onClick={ask} disabled={phase === "asking"} data-testid="near-me">
        <LocateFixed aria-hidden className="size-4" />
        {phase === "asking" ? labels.asking : labels.use}
      </Button>
      <p className="text-xs text-muted-foreground" role="status">
        {phase === "denied" ? labels.denied : phase === "unavailable" ? labels.unavailable : labels.hint}
      </p>
    </div>
  );
}