import { cn } from "@/lib/utils";

/** Top-level success/error message for a form. */
export function FormBanner({ error, message }: { error?: string | undefined; message?: string | undefined }) {
  if (!error && !message) return null;
  return (
    <p
      role={error ? "alert" : "status"}
      className={cn(
        "rounded-lg border px-3 py-2 text-sm",
        error ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-primary/30 bg-primary/5",
      )}
    >
      {error ?? message}
    </p>
  );
}
