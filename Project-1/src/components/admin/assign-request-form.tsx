"use client";

import { useActionState } from "react";
import { FormBanner } from "@/components/form-banner";
import { submitWithoutReset } from "@/components/submit-without-reset";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { assignHelpRequestAction } from "@/server/actions/help-request";
import type { FormState } from "@/server/auth/actions";

const initial: FormState = {};

/** Administrators choose who looks after a request. The list holds active operators and administrators only. */
export function AssignRequestForm({
  requestId,
  currentOperatorId,
  operators,
}: {
  requestId: string;
  currentOperatorId: string | null;
  operators: { user_id: string; full_name: string; roles: string[] }[];
}) {
  const [state, action, pending] = useActionState(assignHelpRequestAction, initial);
  const known = operators.some((o) => o.user_id === currentOperatorId);
  return (
    <form action={action} onSubmit={submitWithoutReset(action)} className="space-y-3 rounded-lg border p-4">
      <input type="hidden" name="request_id" value={requestId} />
      <FormBanner error={state.error} message={state.message} />
      <div className="space-y-1.5">
        <Label htmlFor="operator_id">Assigned to</Label>
        <NativeSelect id="operator_id" name="operator_id" defaultValue={currentOperatorId ?? ""}>
          <option value="">Nobody (unassigned)</option>
          {currentOperatorId && !known ? <option value={currentOperatorId}>Someone no longer on the team</option> : null}
          {operators.map((o) => (
            <option key={o.user_id} value={o.user_id}>
              {o.full_name} ({o.roles.join(", ")})
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Save assignment"}
      </Button>
    </form>
  );
}
