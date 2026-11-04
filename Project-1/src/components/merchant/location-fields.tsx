"use client";

import { useState } from "react";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { Locality } from "@/server/validation";
import { usePincodeHelper } from "./use-pincode-helper";

interface LocationFieldsProps {
  localities: Locality[];
  defaults?: { pincode?: string | null; locality_id?: string | null; latitude?: number | null; longitude?: number | null };
  errors?: { pincode?: string[] | undefined; locality_id?: string[] | undefined };
}

/**
 * Address helpers: type a PIN code to see the place and pick the matching locality, or share your device location to
 * have the nearest PIN code filled in. Everything is a suggestion the user can overwrite; if lookups fail or the PIN
 * directory has not been imported, manual entry still works. The logic is shared with the shop form (use-pincode-helper).
 */
export function LocationFields({ localities, defaults, errors }: LocationFieldsProps) {
  const [localityId, setLocalityId] = useState(defaults?.locality_id ?? "");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    defaults?.latitude != null && defaults?.longitude != null ? { lat: defaults.latitude, lng: defaults.longitude } : null,
  );
  const helper = usePincodeHelper(defaults?.pincode ?? "", {
    onCoords: setCoords,
    onLocalities: (found) => {
      const match = found[0];
      if (match) setLocalityId((current) => (found.some((l) => l.id === current) ? current : match.id));
    },
  });
  const { pincode, note, busy } = helper;
  const onPincodeChange = helper.onChange;
  const useMyLocation = helper.locate;

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
