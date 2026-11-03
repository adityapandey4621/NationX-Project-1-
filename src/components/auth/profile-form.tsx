"use client";

import { useActionState } from "react";
import { FormBanner } from "@/components/form-banner";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { updateProfileAction, type FormState } from "@/server/auth/actions";
import type { Profile } from "@/server/validation";

const initial: FormState = {};

export function ProfileForm({ profile }: { profile: Profile }) {
  const [state, action, pending] = useActionState(updateProfileAction, initial);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormBanner error={state.error} message={state.message} />
      <FormField
        name="full_name"
        label="Full name"
        defaultValue={profile.full_name}
        autoComplete="name"
        required
        errors={state.fieldErrors?.full_name}
      />
      <FormField
        name="phone"
        label="Mobile number"
        type="tel"
        defaultValue={profile.phone}
        autoComplete="tel"
        required
        errors={state.fieldErrors?.phone}
      />
      <div className="space-y-1.5">
        <label htmlFor="preferred_language" className="text-sm font-medium">
          Preferred language
        </label>
        <select
          id="preferred_language"
          name="preferred_language"
          defaultValue={profile.preferred_language}
          className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
        >
          <option value="en">English</option>
          <option value="te">తెలుగు (Telugu)</option>
        </select>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
