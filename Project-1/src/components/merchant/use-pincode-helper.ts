"use client";

import { useState } from "react";
import type { Locality, NearestPincode, PincodeLookup } from "@/server/validation";

/**
 * A post office further than this from the shared position is not used to fill the PIN code: a wrong PIN that looks
 * right is worse than an empty box. The user is told and types it instead.
 */
export const MAX_AUTOFILL_KM = 20;

type Api<T> = { success: true; data: T } | { success: false; error: { message: string } };

async function getJson<T>(url: string): Promise<Api<T> | null> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    return (await res.json()) as Api<T>;
  } catch {
    return null;
  }
}

interface Options {
  /** Called with the localities that use a resolved PIN code (the first is the best match). */
  onLocalities?: (localities: Locality[]) => void;
  /** Called with the shared position (rounded to 6 decimals) so a form can keep it for directions. */
  onCoords?: (coords: { lat: number; lng: number }) => void;
}

/**
 * Behaviour shared by every form that asks for a PIN code: type six digits to see the place, or share the device
 * position to have the nearest post office's PIN filled in. Everything is a suggestion the user can overwrite; if a
 * lookup fails or the PIN directory is empty, typing still works. Coordinates are sent for one query and not stored here.
 */
export function usePincodeHelper(initial: string, options: Options = {}) {
  const [pincode, setPincode] = useState(initial);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function resolve(pin: string): Promise<string> {
    const res = await getJson<PincodeLookup>(`/api/v1/geo/pincode/${pin}`);
    if (res?.success) {
      options.onLocalities?.(res.data.localities);
      return `PIN ${pin}: ${[res.data.offices[0], res.data.district, res.data.state].filter(Boolean).join(", ")}`;
    }
    return "We couldn't match that PIN code automatically. Please check it" + (options.onLocalities ? " and choose your locality below." : ".");
  }

  function onChange(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 6);
    setPincode(digits);
    if (digits.length === 6) void resolve(digits).then(setNote);
    else setNote(null);
  }

  function locate() {
    if (!("geolocation" in navigator)) {
      setNote("Your browser can't share its location. Enter your PIN code instead.");
      return;
    }
    setBusy(true);
    setNote(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        options.onCoords?.({ lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) });
        const res = await getJson<{ suggestions: NearestPincode[] }>(`/api/v1/geo/nearest-pincode?lat=${lat}&lng=${lng}`);
        const best = res?.success ? res.data.suggestions[0] : undefined;
        if (!best) {
          setNote("We couldn't find a PIN code for your position. Please enter it.");
        } else if (best.distance_km > MAX_AUTOFILL_KM) {
          setNote(`The nearest post office we know is about ${Math.round(best.distance_km)} km away, so we did not fill the PIN code. Please enter it.`);
        } else {
          setPincode(best.pincode);
          const away = best.distance_km < 1 ? "less than 1 km" : `about ${Math.round(best.distance_km)} km`;
          setNote(`${await resolve(best.pincode)} (${away} from you). Please check it is right.`);
        }
        setBusy(false);
      },
      (err) => {
        setNote(err.code === 1 ? "Location permission was denied. You can still enter your PIN code." : "We couldn't get your location. Enter your PIN code instead.");
        setBusy(false);
      },
      // maximumAge 0: always the current position. A cached fix from a minute ago could fill the wrong PIN.
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 },
    );
  }

  return { pincode, note, busy, onChange, locate };
}
