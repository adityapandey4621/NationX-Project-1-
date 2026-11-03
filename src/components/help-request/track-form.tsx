"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormBanner } from "@/components/form-banner";
import { FormField } from "@/components/form-field";
import { StatusLine } from "@/components/help-request/status-line";
import { Button } from "@/components/ui/button";
import { trackHelpRequestAction, type HelpRequestState } from "@/server/actions/help-request";

const initial: HelpRequestState = {};

/** Check a request's status without an account: tracking ID + the phone number used. */
export function TrackForm() {
  const [state, action, pending] = useActionState(trackHelpRequestAction, initial);
  const e = state.fieldErrors;
  const t = state.tracked;

  return (
    <div className="space-y-6">
      <form action={action} className="space-y-4" noValidate>
        <FormBanner error={state.error} />
        <FormField name="tracking_id" label="Tracking ID" placeholder="HMF-KHM-202611-0001" autoCapitalize="characters" required errors={e?.tracking_id} />
        <FormField name="contact_phone" label="Mobile number you used" type="tel" inputMode="tel" required errors={e?.contact_phone} />
        <Button type="submit" disabled={pending}>
          {pending ? "Checking…" : "Check status"}
        </Button>
      </form>

      {t ? (
        <div role="status" className="space-y-2 rounded-xl border bg-card p-4">
          <p className="font-mono text-sm">{t.tracking_id}</p>
          <p className="font-medium">{t.item_name}</p>
          <StatusLine status={t.status} />
          {t.resolution_notes ? <p className="text-sm text-muted-foreground">{t.resolution_notes}</p> : null}
          {t.status === "matched" && t.matched_shop_slug ? (
            <Link href={`/shop/${t.matched_shop_slug}`} className="text-sm underline underline-offset-4">
              View the shop
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
