import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface FormFieldProps extends Omit<React.ComponentProps<"input">, "id"> {
  name: string;
  label: string;
  errors?: string[] | undefined;
  hint?: string;
}

/** Label + input + inline error, wired for accessibility. */
export function FormField({ name, label, errors, hint, ...inputProps }: FormFieldProps) {
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={[errors?.length ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined}
        {...inputProps}
      />
      {hint && !errors?.length ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {errors?.length ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {errors[0]}
        </p>
      ) : null}
    </div>
  );
}
