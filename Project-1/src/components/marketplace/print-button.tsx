"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button type="button" size="lg" onClick={() => window.print()} className="print:hidden">
      <Printer aria-hidden className="size-4" /> Print this poster
    </Button>
  );
}