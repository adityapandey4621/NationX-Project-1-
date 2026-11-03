"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormBanner } from "@/components/form-banner";
import { FormField } from "@/components/form-field";
import { buttonVariants, Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { submitHelpRequestAction, type HelpRequestState } from "@/server/actions/help-request";
import type { Category, Locality } from "@/server/validation";

const initial: HelpRequestState = {};

interface Props {
  localities: Locality[];
  categories: Category[];
  signedIn: boolean;
  defaults: {
    item?: string | undefined;
    locality_id?: string | undefined;
    category_id?: string | undefined;
    name?: string | undefined;
    phone?: string | undefined;
    email?: string | undefined;
  };
}

/** "Help me find it": describe a need, choose area (and optionally category), leave contact details. */
export function HelpRequestForm({ localities, categories, signedIn, defaults }: Props) {
  const [state, action, pending] = useActionState(submitHelpRequestAction, initial);
  const e = state.fieldErrors;

  if (state.trackingId) {
    return (
      <div role="status" className="space-y-4 rounded-xl border bg-card p-5">
        <h2 className="text-lg font-semibold">Request received</h2>
        <p className="text-sm">
          Your tracking ID is <strong className="select-all font-mono text-base">{state.trackingId}</strong>. Please note it down.
        </p>
        <p className="text-sm text-muted-foreground">
          Our team will look for a local shop that can help and update this request. We don&apos;t know yet whether anyone stocks it, so
          we can&apos;t promise availability until a shop is confirmed.
        </p>
        <div className="flex flex-wrap gap-2">
          {signedIn ? (
            <Link href="/account/requests" className={buttonVariants()}>
              View my requests
            </Link>
          ) : (
            <Link href="/help-me-find-it/track" className={buttonVariants()}>
              Check status later
            </Link>
          )}
          <Link href="/" className={buttonVariants({ variant: "outline" })}>
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5" noValidate>
      <FormBanner error={state.error} message={state.message} />

      {/* Honeypot: hidden from people; bots tend to fill it. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Leave this field empty</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <FormField name="item_name" label="What are you looking for?" defaultValue={defaults.item ?? ""} maxLength={200} required errors={e?.item_name} hint="e.g. wood-pressed sesame oil, a plumber, brass pooja lamp" />
      <div className="space-y-1.5">
        <Label htmlFor="item_description">More details (optional)</Label>
        <Textarea id="item_description" name="item_description" maxLength={1000} placeholder="Brand, size, quantity, when you need it…" />
        {e?.item_description?.length ? <p role="alert" className="text-xs text-destructive">{e.item_description[0]}</p> : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="locality_id">Your area</Label>
          <NativeSelect id="locality_id" name="locality_id" required defaultValue={defaults.locality_id ?? ""} aria-invalid={e?.preferred_locality_id?.length ? true : undefined}>
            <option value="" disabled>
              Select your area
            </option>
            {localities.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </NativeSelect>
          {e?.preferred_locality_id?.length ? <p role="alert" className="text-xs text-destructive">Choose your area</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="category_id">Category (optional)</Label>
          <NativeSelect id="category_id" name="category_id" defaultValue={defaults.category_id ?? ""}>
            <option value="">Not sure</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <fieldset className="space-y-4">
        <legend className="text-sm font-medium">How can we reach you?</legend>
        <FormField name="contact_name" label="Your name" defaultValue={defaults.name ?? ""} autoComplete="name" required errors={e?.contact_name} />
        <FormField name="contact_phone" label="Mobile number" type="tel" inputMode="tel" autoComplete="tel" defaultValue={defaults.phone ?? ""} placeholder="98480 12345" required errors={e?.contact_phone} />
        <FormField name="contact_email" label="Email (optional)" type="email" autoComplete="email" defaultValue={defaults.email ?? ""} errors={e?.contact_email} />
      </fieldset>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="consent_given" className="mt-0.5 size-4" />
        <span>I agree that NationX may contact me on the number above about this request. My details are used only for this purpose.</span>
      </label>
      {e?.consent_given?.length ? <p role="alert" className="text-xs text-destructive">{e.consent_given[0]}</p> : null}

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Sending…" : "Send request"}
      </Button>
    </form>
  );
}
