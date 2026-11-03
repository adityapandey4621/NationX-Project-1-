"use client";

import { useActionState } from "react";
import { FormBanner } from "@/components/form-banner";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { decideApplicationAction } from "@/server/actions/admin";
import type { FormState } from "@/server/auth/actions";

const initial: FormState = {};

function DecisionForm({
  applicationId,
  decision,
  title,
  children,
  submitLabel,
  destructive,
}: {
  applicationId: string;
  decision: "approve" | "reject" | "request_corrections";
  title: string;
  children: React.ReactNode;
  submitLabel: string;
  destructive?: boolean;
}) {
  const [state, action, pending] = useActionState(decideApplicationAction, initial);
  return (
    <form action={action} className="space-y-3 rounded-lg border p-4">
      <h3 className="font-medium">{title}</h3>
      <input type="hidden" name="application_id" value={applicationId} />
      <input type="hidden" name="decision" value={decision} />
      {children}
      <FormBanner error={state.error} message={state.message} />
      <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={pending}>
        {pending ? "Working…" : submitLabel}
      </Button>
    </form>
  );
}

/** Admin actions for a submitted application. Authorisation is enforced on the server and in the database. */
export function DecisionPanel({ applicationId }: { applicationId: string }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <DecisionForm applicationId={applicationId} decision="approve" title="Approve" submitLabel="Approve & publish storefront">
        <div className="space-y-1.5">
          <Label htmlFor="review_notes">Review notes (optional)</Label>
          <Textarea id="review_notes" name="review_notes" maxLength={1000} placeholder="e.g. Verified in person" />
        </div>
        <FormField name="custom_slug" label="Custom URL slug (optional)" hint="Leave blank to generate automatically. Lowercase letters, numbers, hyphens." />
      </DecisionForm>

      <DecisionForm applicationId={applicationId} decision="request_corrections" title="Request corrections" submitLabel="Send back to applicant">
        <div className="space-y-1.5">
          <Label htmlFor="notes">What needs fixing? (required)</Label>
          <Textarea id="notes" name="notes" required maxLength={2000} />
        </div>
      </DecisionForm>

      <DecisionForm applicationId={applicationId} decision="reject" title="Reject" submitLabel="Reject application" destructive>
        <div className="space-y-1.5">
          <Label htmlFor="reason">Reason (required)</Label>
          <Textarea id="reason" name="reason" required maxLength={1000} />
        </div>
      </DecisionForm>
    </div>
  );
}
