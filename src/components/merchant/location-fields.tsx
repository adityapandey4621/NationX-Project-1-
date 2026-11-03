"use client";

import { useState } from "react";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { Locality, PincodeLookup, NearestPincode } from "@/server/validation";

interface LocationFieldsProps {
  localities: Locality[];
  defaults?: { pincode?: string | null; locality_id?: string | null; latitude?: number | null; longitude?: number | null };
  errors?: { pincode?: string[] | undefined; locality_id?: string[] | undefined };
}

type Api<T> = { success: true; data: T } | { success: false; error: { message: string } };

async function getJson<T>(url: string): Promise<Api<T> | null> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    return (await res.json()) as Api<T>;
  } catch {
    return null;
  }
}

/**
 * Address helpers: type a PIN code to fill district/state and pick the
 * matching locality, or share your device location to get a nearby PIN code.
 * Everything is a suggestion the user can overwrite; if lookups fail or the
 * PIN directory has not been imported, manual entry still works.
 */
export function LocationFields({ localities, defaults, errors }: LocationFieldsProps) {
  const [pincode, setPincode] = useState(defaults?.pincode ?? "");
  const [localityId, setLocalityId] = useState(defaults?.locality_id ?? "");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    defaults?.latitude != null && defaults?.longitude != null ? { lat: defaults.latitude, lng: defaults.longitude } : null,
  );
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function resolvePincode(pin: string) {
    const res = await getJson<PincodeLookup>(`/api/v1/geo/pincode/${pin}`);
    if (res?.success) {
      const place = [res.data.offices[0], res.data.district, res.data.state].filter(Boolean).join(", ");
      setNote(`PIN ${pin}: ${place}`);
      const match = res.data.localities[0];
      if (match) setLocalityId((current) => (res.data.localities.some((l) => l.id === current) ? current : match.id));
    } else {
      setNote("We couldn't match that PIN code automatically. Please choose your locality below.");
    }
  }

  function onPincodeChange(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 6);
    setPincode(digits);
    if (digits.length === 6) void resolvePincode(digits);
    else setNote(null);
  }

  function useMyLocation() {
    if (!("geolocation" in navigator)) {
      setNote("Your browser can't share its location. Enter your PIN code instead.");
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setCoords({ lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) });
        const res = await getJson<{ suggestions: NearestPincode[] }>(`/api/v1/geo/nearest-pincode?lat=${lat}&lng=${lng}`);
        const best = res?.success ? res.data.suggestions[0] : undefined;
        if (best) {
          setPincode(best.pincode);
          await resolvePincode(best.pincode);
        } else {
          setNote("Location saved. We couldn't suggest a PIN code — please enter it.");
        }
        setBusy(false);
      },
      () => {
        setNote("Location permission was denied. You can still enter your PIN code.");
        setBusy(false);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-40 flex-1">
          <FormField
            name="pincode"
            label="PIN code"
            inputMode="numeric"
            maxLength={6}
            autoComplete="postal-code"
            value={pincode}
            onChange={(e) => onPincodeChange(e.target.value)}
            errors={errors?.pincode}
          />
        </div>
        <Button type="button" variant="outline" onClick={useMyLocation} disabled={busy}>
          {busy ? "Locating…" : "Use my location"}
        </Button>
      </div>
      {note ? (
        <p role="status" className="text-xs text-muted-foreground">
          {note}
        </p>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="locality_id">Locality</Label>
        <NativeSelect
          id="locality_id"
          name="locality_id"
          required
          value={localityId}
          onChange={(e) => setLocalityId(e.target.value)}
          aria-invalid={errors?.locality_id?.length ? true : undefined}
        >
          <option value="" disabled>
            Select your locality
          </option>
          {localities.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </NativeSelect>
        {errors?.locality_id?.length ? (
          <p role="alert" className="text-xs text-destructive">
            {errors.locality_id[0]}
          </p>
        ) : null}
      </div>

      {coords ? (
        <>
          <input type="hidden" name="latitude" value={coords.lat} />
          <input type="hidden" name="longitude" value={coords.lng} />
          <p className="text-xs text-muted-foreground">
            Map position saved ({coords.lat}, {coords.lng}). It is used only for directions to your shop.
          </p>
        </>
      ) : null}
    </div>
  );
}
