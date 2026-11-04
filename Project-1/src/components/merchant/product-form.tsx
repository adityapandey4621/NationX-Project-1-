"use client";

import { useActionState, useRef } from "react";
import { FormBanner } from "@/components/form-banner";
import { FormField } from "@/components/form-field";
import { submitWithoutReset } from "@/components/submit-without-reset";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { STOCK_LABELS } from "@/lib/stock";
import { createProductAction, updateProductAction } from "@/server/actions/catalogue";
import type { FormState } from "@/server/auth/actions";
import { STOCK_STATUSES } from "@/server/validation/constants";
import type { Product } from "@/server/validation";

const initial: FormState = {};

/** Create (no `product`) or edit an item. The server re-validates everything and the database enforces ownership. */
export function ProductForm({ shopId, product }: { shopId: string; product?: Product }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(
    async (prev: FormState, formData: FormData) => {
      const result = await (product ? updateProductAction : createProductAction)(prev, formData);
      // Clear the fields after adding, so the next item starts blank.
      if (!product && result.message) formRef.current?.reset();
      return result;
    },
    initial,
  );
  const e = state.fieldErrors;

  return (
    <form ref={formRef} action={action} onSubmit={submitWithoutReset(action)} className="space-y-4" noValidate>
      <FormBanner error={state.error} message={state.message} />
      <input type="hidden" name="shop_id" value={shopId} />
      {product ? <input type="hidden" name="product_id" value={product.id} /> : null}

      <FormField name="name" label="Item name" defaultValue={product?.name ?? ""} required maxLength={160} errors={e?.name} />
      <FormField name="name_te" label="Telugu name (optional)" lang="te" defaultValue={product?.name_te ?? ""} maxLength={160} hint="Helps customers who search in Telugu." errors={e?.name_te} />
      <div className="space-y-1.5">
        <Label htmlFor="description">Description (optional)</Label>
        <Textarea id="description" name="description" defaultValue={product?.description ?? ""} maxLength={1000} />
        {e?.description?.length ? <p role="alert" className="text-xs text-destructive">{e.description[0]}</p> : null}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <FormField name="price" label="Price ₹ (optional)" inputMode="decimal" defaultValue={product?.price ?? ""} hint="Leave blank to show “Call for price”." errors={e?.price} />
        <FormField name="mrp" label="MRP ₹ (optional)" inputMode="decimal" defaultValue={product?.mrp ?? ""} errors={e?.mrp} />
        <FormField name="unit" label="Unit (optional)" defaultValue={product?.unit ?? ""} maxLength={30} hint="e.g. kg, pack, litre" errors={e?.unit} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="stock_status">Availability</Label>
        <select id="stock_status" name="stock_status" defaultValue={product?.stock_status ?? "call_to_confirm"} className="h-9 w-full rounded-lg border bg-background px-3 text-sm">
          {STOCK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STOCK_LABELS[s]}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Customers see “In stock” or “Out of stock” only while it was confirmed in the last 3 days; after that they see “Call to confirm”.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="is_published" defaultChecked={product ? product.is_published : true} className="size-4" />
        Show on my public page
      </label>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : product ? "Save item" : "Add item"}
      </Button>
    </form>
  );
}
