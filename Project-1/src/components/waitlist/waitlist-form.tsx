"use client";

import { useActionState, useState } from "react";
import { FormBanner } from "@/components/form-banner";
import { submitWithoutReset } from "@/components/submit-without-reset";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { joinWaitlistAction, leaveWaitlistAction, type WaitlistState } from "@/server/actions/waitlist";
import type { Category, Locality } from "@/server/validation";

export interface WaitlistLabels {
  area: string;
  areaSelect: string;
  category: string;
  categoryAny: string;
  name: string;
  phone: string;
  consent: string;
  submit: string;
  sending: string;
  joinedTitle: string;
  joinedBody: string;
  already: string;
  leaveTitle: string;
  leaveBody: string;
  leave: string;
  left: string;
}

const initial: WaitlistState = {};

const inputCls =
  "h-10 w-full min-w-0 rounded-xl border border-input bg-card px-3 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm dark:bg-input/30";

/**
 * A plain controlled text field. The shared FormField wraps a library input that does not forward `onChange`,
 * and this form must keep what was typed when validation fails.
 */
function TextField({ id, name, label, errors, ...rest }: React.ComponentProps<"input"> & { id: string; name: string; label: string; errors?: string[] | undefined }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <input id={id} name={name} aria-invalid={errors?.length ? true : undefined} aria-describedby={errors?.length ? `${id}-error` : undefined} className={inputCls} {...rest} />
      {errors?.length ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {errors[0]}
        </p>
      ) : null}
    </div>
  );
}

function Honeypot() {
  return (
    <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
      <label htmlFor="website">Leave this field empty</label>
      <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
    </div>
  );
}

/** Join an area list (with explicit consent) or remove yourself. Labels come from the server so the form is translated. */
export function WaitlistForm({
  localities,
  categories,
  defaultLocalityId,
  labels,
}: {
  localities: Locality[];
  categories: Category[];
  defaultLocalityId?: string | undefined;
  labels: WaitlistLabels;
}) {
  const [join, joinAction, joining] = useActionState(joinWaitlistAction, initial);
  const [leave, leaveAction, leaving] = useActionState(leaveWaitlistAction, initial);
  const e = join.fieldErrors;
  // Controlled on purpose: React 19 resets an uncontrolled form after every action, which would wipe what the
  // person typed whenever validation fails (for example they forgot to tick consent).
  const [locality, setLocality] = useState(defaultLocalityId ?? "");
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const le = leave.fieldErrors;

  return (
    <div className="space-y-10">
      {join.joined ? (
        <div role="status" className="space-y-2 rounded-2xl border bg-card p-5 shadow-card">
          <h2 className="text-lg font-semibold">{labels.joinedTitle}</h2>
          <p className="text-sm text-foreground/80">{join.joined === "already_waiting" ? labels.already : labels.joinedBody}</p>
        </div>
      ) : (
        <form action={joinAction} onSubmit={submitWithoutReset(joinAction)} className="space-y-5" noValidate>
          <FormBanner error={join.error} message={join.message} />
          <Honeypot />
          <div className="space-y-1.5">
            <Label htmlFor="locality_id">{labels.area}</Label>
            <NativeSelect id="locality_id" name="locality_id" required value={locality} onChange={(ev) => setLocality(ev.target.value)} aria-invalid={e?.locality_id?.length ? true : undefined}>
              <option value="" disabled>
                {labels.areaSelect}
              </option>
              {localities.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </NativeSelect>
            {e?.locality_id?.length ? <p role="alert" className="text-xs text-destructive">{labels.areaSelect}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="category_id">{labels.category}</Label>
            <NativeSelect id="category_id" name="category_id" value={category} onChange={(ev) => setCategory(ev.target.value)}>
              <option value="">{labels.categoryAny}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <TextField id="contact_name" name="contact_name" label={labels.name} autoComplete="name" maxLength={120} value={name} onChange={(ev) => setName(ev.target.value)} errors={e?.contact_name} />
          <TextField id="contact_phone" name="contact_phone" label={labels.phone} type="tel" inputMode="tel" autoComplete="tel" placeholder="98480 12345" required value={phone} onChange={(ev) => setPhone(ev.target.value)} errors={e?.contact_phone} />
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="consent_given" className="mt-0.5 size-4" />
            <span>{labels.consent}</span>
          </label>
          {e?.consent_given?.length ? <p role="alert" className="text-xs text-destructive">{e.consent_given[0]}</p> : null}
          <Button type="submit" size="lg" disabled={joining}>
            {joining ? labels.sending : labels.submit}
          </Button>
        </form>
      )}

      <section aria-labelledby="leave-h" className="space-y-3 border-t pt-6">
        <h2 id="leave-h" className="text-base font-semibold">
          {labels.leaveTitle}
        </h2>
        <p className="text-sm text-muted-foreground">{labels.leaveBody}</p>
        {leave.left ? (
          <p role="status" className="text-sm font-medium text-success">
            {labels.left}
          </p>
        ) : (
          <form action={leaveAction} onSubmit={submitWithoutReset(leaveAction)} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" noValidate>
            <FormBanner error={leave.error} />
            <div className="space-y-1.5">
              <Label htmlFor="leave_locality">{labels.area}</Label>
              <NativeSelect id="leave_locality" name="locality_id" required defaultValue={defaultLocalityId ?? ""}>
                <option value="" disabled>
                  {labels.areaSelect}
                </option>
                {localities.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <TextField id="leave_phone" name="contact_phone" label={labels.phone} type="tel" inputMode="tel" autoComplete="tel" required errors={le?.contact_phone} />
            <Button type="submit" variant="outline" size="lg" disabled={leaving}>
              {labels.leave}
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}