import { removeApplicationFileAction } from "@/server/actions/merchant";
import { Button } from "@/components/ui/button";
import type { ApplicationWithNames } from "@/server/services";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="grid grid-cols-3 gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="col-span-2 break-words">{children}</dd>
    </div>
  );
}

export interface SignedFile {
  path: string;
  url: string | null;
  label: string;
}

/** Read-only view of an application's content and uploaded files. */
export function ApplicationSummary({
  application: a,
  files,
  removableApplicationId,
}: {
  application: ApplicationWithNames;
  files: SignedFile[];
  /** When set, each file gets a Remove button bound to this application (applicant, editable states only). */
  removableApplicationId?: string;
}) {
  return (
    <div className="space-y-4">
      <dl className="divide-y">
        <Row label="Business">{a.business_name}</Row>
        <Row label="Category">{a.category?.name}</Row>
        <Row label="Description">{a.business_description}</Row>
        <Row label="Phone">{a.contact_phone}</Row>
        <Row label="WhatsApp">{a.whatsapp_number}</Row>
        <Row label="Email">{a.contact_email}</Row>
        <Row label="Address">{[a.address_line1, a.address_line2].filter(Boolean).join(", ")}</Row>
        <Row label="Landmark">{a.landmark}</Row>
        <Row label="Locality">{a.locality?.name}</Row>
        <Row label="PIN code">{a.pincode}</Row>
        <Row label="Map position">{a.latitude != null && a.longitude != null ? `${a.latitude}, ${a.longitude}` : null}</Row>
        <Row label="Hours">{a.opening_time && a.closing_time ? `${a.opening_time.slice(0, 5)} – ${a.closing_time.slice(0, 5)}` : null}</Row>
        <Row label="Weekly off">{a.weekly_off_days?.length ? a.weekly_off_days.map(cap).join(", ") : null}</Row>
        <Row label="Operating model">{a.operating_models.map((m) => cap(m.replace("_", " "))).join(", ")}</Row>
        <Row label="Declaration">{a.declaration_accepted ? "Accepted" : "Not accepted"}</Row>
      </dl>

      <div>
        <h3 className="mb-2 text-sm font-medium">Files</h3>
        {files.length === 0 ? (
          <p className="text-sm text-muted-foreground">No files uploaded.</p>
        ) : (
          <ul className="space-y-1.5">
            {files.map((f) => (
              <li key={f.path} className="flex items-center justify-between gap-3 text-sm">
                {f.url ? (
                  <a href={f.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                    {f.label}
                  </a>
                ) : (
                  <span className="text-muted-foreground">{f.label} (link unavailable)</span>
                )}
                {removableApplicationId ? (
                  <form action={removeApplicationFileAction}>
                    <input type="hidden" name="application_id" value={removableApplicationId} />
                    <input type="hidden" name="path" value={f.path} />
                    <Button type="submit" variant="ghost" size="xs">
                      Remove
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Label for a stored private file path, e.g. `…/photo-<uuid>.jpg` → "Photo (jpg)". */
export function fileLabel(path: string, index: number): string {
  const name = path.split("/").pop() ?? "";
  const kind = name.split("-")[0] ?? "file";
  const ext = name.split(".").pop() ?? "";
  return `${cap(kind)} ${index + 1} (${ext})`;
}
