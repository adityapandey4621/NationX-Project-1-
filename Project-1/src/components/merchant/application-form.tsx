"use client";

import { useActionState, useState } from "react";
import { FormBanner } from "@/components/form-banner";
import { FormField } from "@/components/form-field";
import { LocationFields } from "@/components/merchant/location-fields";
import { submitWithoutReset } from "@/components/submit-without-reset";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { saveApplicationAction } from "@/server/actions/merchant";
import type { FormState } from "@/server/auth/actions";
import { DETAIL_FIELD_PREFIX } from "@/server/validation/category-details";
import { OPERATING_MODELS, WEEKDAYS } from "@/server/validation/constants";
import type { Category, CategoryAttribute, Locality, MerchantApplication, Subcategory } from "@/server/validation";

const initial: FormState = {};

const MODEL_LABELS: Record<(typeof OPERATING_MODELS)[number], string> = {
  visit_only: "Customers visit the shop",
  pickup: "Pickup",
  delivery: "Delivery",
  appointment: "By appointment",
  quotation: "Quotation / enquiry",
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Category-adaptive form (REQ-APP-02): what a shop is asked follows the category's template, which is data
 * (Admin, Categories and areas), so a new category needs no code. A service provider is never offered
 * pickup or delivery, and is asked about services rather than stock.
 */
const MODELS_BY_TEMPLATE: Record<string, readonly (typeof OPERATING_MODELS)[number][]> = {
  grocery: ["visit_only", "pickup", "delivery"],
  standard_retail: ["visit_only", "pickup", "delivery", "quotation"],
  service_provider: ["visit_only", "appointment", "quotation"],
  artisan: ["visit_only", "pickup", "delivery", "quotation"],
};
const COPY_BY_TEMPLATE: Record<string, { description: string; placeholder: string; hint: string }> = {
  grocery: { description: "What do you sell?", placeholder: "e.g. groceries, vegetables, daily needs", hint: "After approval you can list items and mark each In stock, Call to confirm or Out of stock." },
  standard_retail: { description: "What do you sell?", placeholder: "e.g. hardware, medicines, clothes", hint: "After approval you can list items with prices and availability." },
  service_provider: { description: "What services do you offer?", placeholder: "e.g. haircut and styling, plumbing repairs", hint: "Service shops list services and prices, with no stock labels. Customers book by appointment or ask for a quote." },
  artisan: { description: "What do you make?", placeholder: "e.g. handloom sarees, brass lamps", hint: "After approval you can list your work with photos and prices." },
};

function CheckboxGroup({
  legend,
  name,
  options,
  selected,
  error,
}: {
  legend: string;
  name: string;
  options: { value: string; label: string }[];
  selected: readonly string[];
  error?: string | undefined;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {options.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name={name} value={o.value} defaultChecked={selected.includes(o.value)} className="size-4" />
            {o.label}
          </label>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

interface ApplicationFormProps {
  localities: Locality[];
  categories: Category[];
  /** Every active subcategory; the list shown follows the chosen category. */
  subcategories?: Subcategory[];
  /** Every active question an administrator attached to a category; the ones shown follow the chosen category. */
  questions?: CategoryAttribute[];
  application?: MerchantApplication | null;
}

/** One admin-defined question, rendered by its answer type. Names are `detail_<key>`; the server re-validates everything. */
function QuestionField({ q, value, errors }: { q: CategoryAttribute; value: unknown; errors?: string[] | undefined }) {
  const name = `${DETAIL_FIELD_PREFIX}${q.key}`;
  const label = q.is_required ? q.label : `${q.label} (optional)`;
  if (q.field_type === "text") {
    return <FormField name={name} label={label} defaultValue={typeof value === "string" ? value : ""} maxLength={200} hint={q.help_text ?? undefined} errors={errors} />;
  }
  if (q.field_type === "number") {
    return <FormField name={name} label={label} inputMode="decimal" defaultValue={typeof value === "number" ? String(value) : ""} hint={q.help_text ?? undefined} errors={errors} />;
  }
  const current = q.field_type === "yes_no" ? (value === true ? "yes" : value === false ? "no" : "") : typeof value === "string" ? value : "";
  const options = q.field_type === "yes_no" ? [{ v: "yes", l: "Yes" }, { v: "no", l: "No" }] : q.options.map((o) => ({ v: o, l: o }));
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <NativeSelect id={name} name={name} defaultValue={current} aria-invalid={errors?.length ? true : undefined}>
        <option value="">{q.is_required ? "Select" : "Not answered"}</option>
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.l}
          </option>
        ))}
      </NativeSelect>
      {q.help_text ? <p className="text-xs text-muted-foreground">{q.help_text}</p> : null}
      {errors?.length ? <p role="alert" className="text-xs text-destructive">{errors[0]}</p> : null}
    </div>
  );
}

/** "Add your shop" form: save a draft any time, submit when complete. */
export function ApplicationForm({ localities, categories, subcategories = [], questions = [], application }: ApplicationFormProps) {
  const [state, action, pending] = useActionState(saveApplicationAction, initial);
  const e = state.fieldErrors;
  const a = application;
  // Which questions to ask follows the chosen category. `onReset` re-syncs after React's automatic form reset.
  const [categoryId, setCategoryId] = useState(a?.category_id ?? "");
  const template = categories.find((c) => c.id === categoryId)?.default_template;
  const subsHere = subcategories.filter((s) => s.category_id === categoryId);
  const questionsHere = questions.filter((q) => q.category_id === categoryId);
  // Saved answers only belong to the category they were given for.
  const savedDetails = a && a.category_id === categoryId ? a.category_specific_data : {};
  const allowedModels = template ? (MODELS_BY_TEMPLATE[template] ?? OPERATING_MODELS) : OPERATING_MODELS;
  const copy = template ? COPY_BY_TEMPLATE[template] : undefined;

  return (
    <form action={action} onSubmit={submitWithoutReset(action)} onReset={() => setCategoryId(a?.category_id ?? "")} className="space-y-8" noValidate>
      <FormBanner error={state.error} message={state.message} />
      {a ? <input type="hidden" name="application_id" value={a.id} /> : null}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">About your business</h2>
        <FormField name="business_name" label="Shop / business name" defaultValue={a?.business_name ?? ""} required errors={e?.business_name} />
        <div className="space-y-1.5">
          <Label htmlFor="category_id">Category</Label>
          <NativeSelect id="category_id" name="category_id" defaultValue={a?.category_id ?? ""} onChange={(ev) => setCategoryId(ev.target.value)} required aria-invalid={e?.category_id?.length ? true : undefined}>
            <option value="" disabled>
              Select a category
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
          {e?.category_id?.length ? <p role="alert" className="text-xs text-destructive">{e.category_id[0]}</p> : null}
          {copy ? <p className="text-xs text-muted-foreground">{copy.hint}</p> : null}
        </div>
        {subsHere.length > 0 ? (
          <div className="space-y-1.5" key={`sub-${categoryId}`}>
            <Label htmlFor="subcategory_id">Subcategory (optional)</Label>
            <NativeSelect id="subcategory_id" name="subcategory_id" defaultValue={a && a.category_id === categoryId ? (a.subcategory_id ?? "") : ""} aria-invalid={e?.subcategory_id?.length ? true : undefined}>
              <option value="">Not sure / none of these</option>
              {subsHere.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
            {e?.subcategory_id?.length ? <p role="alert" className="text-xs text-destructive">{e.subcategory_id[0]}</p> : null}
          </div>
        ) : null}
        {questionsHere.length > 0 ? (
          <fieldset className="space-y-4" key={`q-${categoryId}`}>
            <legend className="text-sm font-medium">More about your shop</legend>
            {questionsHere.map((q) => (
              <QuestionField key={q.id} q={q} value={savedDetails[q.key]} errors={e?.[`${DETAIL_FIELD_PREFIX}${q.key}`]} />
            ))}
          </fieldset>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="business_description">{copy?.description ?? "Description"}</Label>
          <Textarea id="business_description" name="business_description" defaultValue={a?.business_description ?? ""} maxLength={2000} placeholder={copy?.placeholder ?? "What do you sell or offer?"} />
          {e?.business_description?.length ? <p role="alert" className="text-xs text-destructive">{e.business_description[0]}</p> : null}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Contact</h2>
        <FormField name="contact_phone" label="Shop phone" type="tel" inputMode="tel" placeholder="+919876543210" defaultValue={a?.contact_phone ?? ""} required errors={e?.contact_phone} />
        <FormField name="whatsapp_number" label="WhatsApp number (optional)" type="tel" inputMode="tel" placeholder="+919876543210" defaultValue={a?.whatsapp_number ?? ""} errors={e?.whatsapp_number} />
        <FormField name="contact_email" label="Email (optional)" type="email" defaultValue={a?.contact_email ?? ""} hint="Used by NationX to contact you. Not shown publicly." errors={e?.contact_email} />
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Location</h2>
        <FormField name="address_line1" label="Address" autoComplete="street-address" defaultValue={a?.address_line1 ?? ""} required errors={e?.address_line1} />
        <FormField name="address_line2" label="Address line 2 (optional)" defaultValue={a?.address_line2 ?? ""} errors={e?.address_line2} />
        <FormField name="landmark" label="Landmark (optional)" defaultValue={a?.landmark ?? ""} errors={e?.landmark} />
        <LocationFields
          localities={localities}
          defaults={{ pincode: a?.pincode, locality_id: a?.locality_id, latitude: a?.latitude, longitude: a?.longitude }}
          errors={{ pincode: e?.pincode, locality_id: e?.locality_id }}
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Hours & how customers shop</h2>
        <div className="grid grid-cols-2 gap-4">
          <FormField name="opening_time" label="Opens" type="time" defaultValue={a?.opening_time?.slice(0, 5) ?? ""} errors={e?.opening_time} />
          <FormField name="closing_time" label="Closes" type="time" defaultValue={a?.closing_time?.slice(0, 5) ?? ""} errors={e?.closing_time} />
        </div>
        <CheckboxGroup legend="Weekly off days" name="weekly_off_days" options={WEEKDAYS.map((d) => ({ value: d, label: cap(d) }))} selected={a?.weekly_off_days ?? []} />
        <CheckboxGroup
          key={template ?? "any"}
          legend="Operating model"
          name="operating_models"
          options={allowedModels.map((m) => ({ value: m, label: MODEL_LABELS[m] }))}
          selected={(a?.operating_models ?? ["visit_only"]).filter((m) => (allowedModels as readonly string[]).includes(m))}
          error={e?.operating_models?.[0]}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Declaration</h2>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="declaration_accepted" defaultChecked={a?.declaration_accepted ?? false} className="mt-0.5 size-4" />
          <span>
            I confirm that the information is accurate, that I am authorised to represent this business, and I consent to NationX
            verifying it and publishing the shop details above.
          </span>
        </label>
        {e?.declaration_accepted?.length ? <p role="alert" className="text-xs text-destructive">{e.declaration_accepted[0]}</p> : null}
      </section>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" name="intent" value="submit" disabled={pending}>
          {pending ? "Working…" : "Submit for review"}
        </Button>
        <Button type="submit" name="intent" value="save_draft" variant="outline" disabled={pending}>
          Save draft
        </Button>
      </div>
      {!a ? <p className="text-xs text-muted-foreground">Save a draft first to upload your logo, photos and documents.</p> : null}
    </form>
  );
}
