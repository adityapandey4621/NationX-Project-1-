"use client";

import { Button } from "@/components/ui/button";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-md space-y-4 px-4 py-16">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        We hit an unexpected problem. Please try again; if it keeps happening, contact NationX support.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
