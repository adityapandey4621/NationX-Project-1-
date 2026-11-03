"use client";

import { useActionState } from "react";
import { FormBanner } from "@/components/form-banner";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { updateHelpRequestAction } from "@/server/actions/help-request";
import type { FormState } from "@/server/auth/actions";

const initial: FormState = {};

/** Staff handling form. Matching is manual: a person confirms a real, published shop. */
export function HelpRequestPanel({ requestId, currentStatus }: { requestId: string; currentStatus: string }) {
  const [state, action, pending] = useActionState(updateHelpRequestAction, initial);
  const closed = currentStatus === "cancelled";
  const terminal = currentStatus === "matched" || currentStatus === "unresolved";

  if (closed) return <p className="text-sm text-muted-foreground">This request was cancelled and can&apos;t be changed.</p>;

  return (
    <form action={action} className="space-y-4 rounded-lg border p-4">
      <input type="hidden" name="request_id" value={requestId} />
      <FormBanner error={state.error} message={state.message} />
      <div className="space-y-1.5">
        <Label htmlFor="status">Set status</Label>
        <NativeSelect id="status" name="status" defaultValue={terminal ? "under_review" : "under_review"}>
          <option value="under_review">Being looked at</option>
          {terminal ? null : <option value="matched">Shop found (matched)</option>}
          {terminal ? null : <option value="unresolved">Couldn&apos;t find it (unresolved)</option>}
          {terminal ? null : <option value="cancelled">Cancelled</option>}
        </NativeSelect>
        {terminal ? <p className="text-xs text-muted-foreground">Finished requests can only be reopened.</p> : null}
      </div>
      {terminal ? null : (
        <FormField
          name="matched_shop_slug"
          label="Matched shop (storefront slug)"
          hint="Required for “matched”: the /shop/<slug> of a published shop that confirmed it can help."
        />
      )}
      <div className="space-y-1.5">
        <Label htmlFor="notes">Note to the customer / internal note</Label>
        <Textarea id="notes" name="notes" maxLength={1000} placeholder="Required for “unresolved”. Shown to the requester." />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Update request"}
      </Button>
    </form>
  );
}
