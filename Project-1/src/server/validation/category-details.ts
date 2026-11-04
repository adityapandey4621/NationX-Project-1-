import type { CategoryAttribute } from "./taxonomy";

/**
 * Answers to the questions an administrator attached to a category. Form fields are named `detail_<key>`.
 * The database re-validates every save (migration 020); this module gives the applicant clear, field-level
 * messages first, and is the only place the form's text is turned into typed values.
 */
export type DetailValue = string | number | boolean;
export type CategoryDetails = Record<string, DetailValue>;

export const DETAIL_FIELD_PREFIX = "detail_";
export const MAX_TEXT_ANSWER = 200;

/** Read the answers for the given questions from a submitted form. Blank answers are left out. */
export function parseCategoryDetails(formData: FormData, attributes: readonly CategoryAttribute[]): { details: CategoryDetails; errors: Record<string, string[]> } {
  const details: CategoryDetails = {};
  const errors: Record<string, string[]> = {};
  for (const a of attributes) {
    const name = `${DETAIL_FIELD_PREFIX}${a.key}`;
    const raw = formData.get(name);
    const text = typeof raw === "string" ? raw.trim() : "";
    if (text === "") continue;
    const fail = (message: string) => {
      errors[name] = [message];
    };
    switch (a.field_type) {
      case "text":
        if (text.length > MAX_TEXT_ANSWER) fail(`${a.label}: at most ${MAX_TEXT_ANSWER} characters`);
        else details[a.key] = text;
        break;
      case "number": {
        // Reject "1e3", "0x10", " " and "12abc": only plain decimal numbers are answers. Nine digits keeps the
        // value inside the database's own limit (plus or minus one billion, migration 020).
        if (!/^-?\d{1,9}(\.\d{1,4})?$/.test(text)) fail(`${a.label}: enter a number`);
        else details[a.key] = Number(text);
        break;
      }
      case "choice":
        if (!a.options.includes(text)) fail(`${a.label}: choose one of the listed options`);
        else details[a.key] = text;
        break;
      case "yes_no":
        if (text === "yes") details[a.key] = true;
        else if (text === "no") details[a.key] = false;
        else fail(`${a.label}: choose Yes or No`);
        break;
    }
  }
  return { details, errors };
}

/** Mandatory questions that have no answer. Used when the application is submitted (drafts may be incomplete). */
export function missingRequired(details: CategoryDetails, attributes: readonly CategoryAttribute[]): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const a of attributes) {
    if (a.is_required && !(a.key in details)) errors[`${DETAIL_FIELD_PREFIX}${a.key}`] = [`${a.label}: this question must be answered`];
  }
  return errors;
}

/** Human-readable answer for display ("Yes"/"No" for booleans). Only questions that have an answer are listed. */
export function describeDetails(details: Record<string, unknown>, attributes: readonly CategoryAttribute[]): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (const a of [...attributes].sort((x, y) => x.display_order - y.display_order)) {
    if (!a.is_active || !(a.key in details)) continue;
    const v = details[a.key];
    // Each value must match its question's type; anything else (old or tampered data) is not shown.
    if (a.field_type === "yes_no" && typeof v === "boolean") out.push({ label: a.label, value: v ? "Yes" : "No" });
    else if (a.field_type === "number" && typeof v === "number" && Number.isFinite(v)) out.push({ label: a.label, value: String(v) });
    else if ((a.field_type === "text" || a.field_type === "choice") && typeof v === "string" && v.trim() !== "") out.push({ label: a.label, value: v });
  }
  return out;
}
