"use client";

import { useActionState, useRef } from "react";
import { FormBanner } from "@/components/form-banner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/server/auth/actions";

const initial: FormState = {};

interface FileUploaderProps {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  label: string;
  kind: string;
  accept: string;
  hidden: Record<string, string>;
  hint?: string;
}

/** Single-file upload form bound to a server action; the server re-validates type and size. */
export function FileUploader({ action, label, kind, accept, hidden, hint }: FileUploaderProps) {
  const [state, formAction, pending] = useActionState(
    async (prev: FormState, formData: FormData) => {
      const result = await action(prev, formData);
      if (result.message) formRef.current?.reset();
      return result;
    },
    initial,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const id = `file-${kind}`;

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input type="hidden" name="kind" value={kind} />
      <Label htmlFor={id}>{label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <input id={id} type="file" name="file" accept={accept} required className="max-w-full text-sm file:mr-3 file:rounded-lg file:border file:bg-background file:px-3 file:py-1" />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Uploading…" : "Upload"}
        </Button>
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <FormBanner error={state.error} message={state.message} />
    </form>
  );
}
