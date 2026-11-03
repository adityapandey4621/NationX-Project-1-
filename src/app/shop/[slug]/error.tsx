"use client";

import { Button } from "@/components/ui/button";

export default function StorefrontError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-md space-y-4 px-4 py-16">
      <h1 className="text-xl font-semibold">We couldn&apos;t load this shop</h1>
      <p className="text-sm text-muted-foreground">Please check your connection and try again.</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
