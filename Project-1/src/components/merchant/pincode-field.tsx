"use client";

import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { usePincodeHelper } from "./use-pincode-helper";

/** PIN code box with a "Use my location" button that fills it from the nearest post office. */
export function PincodeField({ defaultValue, errors }: { defaultValue?: string | null; errors?: string[] | undefined }) {
  const helper = usePincodeHelper(defaultValue ?? "");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-40 flex-1">
          <FormField
            name="pincode"
            label="PIN code"
            inputMode="numeric"
            maxLength={6}
            autoComplete="postal-code"
            value={helper.pincode}
            onChange={(e) => helper.onChange(e.target.value)}
            errors={errors}
          />
        </div>
        <Button type="button" variant="outline" onClick={helper.locate} disabled={helper.busy}>
          {helper.busy ? "Locating…" : "Use my location"}
        </Button>
      </div>
      {helper.note ? (
        <p role="status" className="text-xs text-muted-foreground">
          {helper.note}
        </p>
      ) : null}
    </div>
  );
}
