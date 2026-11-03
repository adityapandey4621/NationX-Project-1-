"use client";

import { useActionState } from "react";
import { FormBanner } from "@/components/form-banner";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { signInAction, type FormState } from "@/server/auth/actions";

const initial: FormState = {};

export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signInAction, initial);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormBanner error={state.error} message={state.message} />
      <input type="hidden" name="next" value={next} />
      <FormField name="email" label="Email" type="email" autoComplete="email" required errors={state.fieldErrors?.email} />
      <FormField
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        errors={state.fieldErrors?.password}
      />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
