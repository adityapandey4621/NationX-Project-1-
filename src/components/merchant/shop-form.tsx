"use client";

import { useActionState } from "react";
import { FormBanner } from "@/components/form-banner";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateShopAction } from "@/server/actions/shop";
import type { FormState } from "@/server/auth/actions";
import { OPERATING_MODELS, WEEKDAYS, type ManagedShop } from "@/server/validation";

const initial: FormState = {};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const MODEL_LABELS: Record<(typeof OPERATING_MODELS)[number], string> = {
  visit_only: "Customers visit the shop",
  pickup: "Pickup",
  delivery: "Delivery",
  appointment: "By appointment",
  quotation: "Quotation / enquiry",
};

/** Permitted edits only. Name, category, locality and URL are managed by NationX (re-verification). */
export function ShopForm({ shop }: { shop: ManagedShop }) {
  const [state, action, pending] = useActionState(updateShopAction, initial);
  const e = state.fieldErrors;
  const sf = shop.storefront;

  return (
    <form action={action} className="space-y-5" noValidate>
      <FormBanner error={state.error} message={state.message} />
      <input type="hidden" name="shop_id" value={shop.id} />

      <FormField name="headline" label="Headline" defaultValue={sf?.headline ?? ""} hint="A short line shown under your shop name, e.g. today's offer or announcement." errors={e?.headline} />
      <div className="space-y-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" defaultValue={sf?.description ?? ""} maxLength={2000} />
        {e?.description?.length ? <p role="alert" className="text-xs text-destructive">{e.description[0]}</p> : null}
      </div>

      <FormField name="phone" label="Phone" type="tel" defaultValue={shop.phone} required errors={e?.phone} />
      <FormField name="whatsapp" label="WhatsApp (optional)" type="tel" defaultValue={shop.whatsapp ?? ""} errors={e?.whatsapp} />
      <FormField name="address_line" label="Address" defaultValue={shop.address_line} required errors={e?.address_line} />
      <FormField name="landmark" label="Landmark" defaultValue={shop.landmark ?? ""} errors={e?.landmark} />
      <FormField name="pincode" label="PIN code" inputMode="numeric" maxLength={6} defaultValue={shop.pincode ?? ""} errors={e?.pincode} />

      <div className="grid grid-cols-2 gap-4">
        <FormField name="opens" label="Opens" type="time" defaultValue={shop.operating_hours.opens} required errors={e?.operating_hours} />
        <FormField name="closes" label="Closes" type="time" defaultValue={shop.operating_hours.closes} required />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Weekly off days</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {WEEKDAYS.map((d) => (
            <label key={d} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="closed_days" value={d} defaultChecked={shop.operating_hours.closed_days.map((x) => x.toLowerCase()).includes(d)} className="size-4" />
              {cap(d)}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Operating model</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {OPERATING_MODELS.map((m) => (
            <label key={m} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="operating_models" value={m} defaultChecked={shop.operating_models.includes(m)} className="size-4" />
              {MODEL_LABELS[m]}
            </label>
          ))}
        </div>
        {e?.operating_models?.length ? <p role="alert" className="text-xs text-destructive">{e.operating_models[0]}</p> : null}
      </fieldset>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
