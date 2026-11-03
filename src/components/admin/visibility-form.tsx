"use client";

import { useActionState } from "react";
import { FormBanner } from "@/components/form-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setVisibilityAction } from "@/server/actions/admin";
import type { FormState } from "@/server/auth/actions";

const initial: FormState = {};

const ACTIONS = {
  visible: { label: "Reactivate", variant: "default" as const },
  hidden: { label: "Hide", variant: "outline" as const },
  suspended: { label: "Suspend", variant: "destructive" as const },
};

/** Moderation controls for one storefront. Authorisation is enforced on the server and in the database. */
export function VisibilityForm({
  storefrontId,
  slug,
  current,
}: {
  storefrontId: string;
  slug: string;
  current: "visible" | "hidden" | "suspended";
}) {
  const [state, action, pending] = useActionState(setVisibilityAction, initial);
  const targets = (Object.keys(ACTIONS) as (keyof typeof ACTIONS)[]).filter((s) => s !== current);
  const inputId = `reason-${storefrontId}`;

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="storefront_id" value={storefrontId} />
      <input type="hidden" name="slug" value={slug} />
      <div className="space-y-1">
        <Label htmlFor={inputId}>Reason {current === "visible" ? "(required to hide or suspend)" : "(optional when reactivating)"}</Label>
        <Input id={inputId} name="reason" maxLength={500} autoComplete="off" />
      </div>
      <div className="flex flex-wrap gap-2">
        {targets.map((s) => (
          <Button key={s} type="submit" name="status" value={s} size="sm" variant={ACTIONS[s].variant} disabled={pending}>
            {ACTIONS[s].label}
          </Button>
        ))}
      </div>
      <FormBanner error={state.error} message={state.message} />
    </form>
  );
}
