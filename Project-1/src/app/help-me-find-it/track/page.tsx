import type { Metadata } from "next";
import Link from "next/link";
import { TrackForm } from "@/components/help-request/track-form";

export const metadata: Metadata = { title: "Track a request", robots: { index: false } };

export default function TrackPage() {
  return (
    <div className="mx-auto max-w-xl space-y-6 px-4 py-10">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Track your request</h1>
        <p className="text-sm text-muted-foreground">
          Enter the tracking ID you received and the mobile number you used. Both are needed to protect your privacy.
        </p>
      </div>
      <TrackForm />
      <p className="text-sm">
        <Link href="/help-me-find-it" className="underline underline-offset-4">
          Make a new request
        </Link>
      </p>
    </div>
  );
}
