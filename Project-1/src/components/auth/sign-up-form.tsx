"use client";

import { useActionState } from "react";
import { FormBanner } from "@/components/form-banner";
import { FormField } from "@/components/form-field";
import { submitWithoutReset } from "@/components/submit-without-reset";
import { Button } from "@/components/ui/button";
import { signUpAction, type FormState } from "@/server/auth/actions";

const initial: FormState = {};

export function SignUpForm() {
  const [state, action, pending] = useActionState(signUpAction, initial);
  return (
    <form action={action} onSubmit={submitWithoutReset(action)} className="space-y-4" noValidate>
      <FormBanner error={state.error} message={state.message} />
      <FormField name="full_name" label="Full name" autoComplete="name" required errors={state.fieldErrors?.full_name} />
      <FormField name="email" label="Email" type="email" autoComplete="email" required errors={state.fieldErrors?.email} />
      <FormField
        name="phone"
        label="Mobile number"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="+919876543210"
        hint="Indian mobile number starting with +91"
        required
        errors={state.fieldErrors?.phone}
      />
      <FormField
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        hint="At least 8 characters"
        required
        errors={state.fieldErrors?.password}
      />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
