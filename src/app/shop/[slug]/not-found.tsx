import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function StorefrontNotFound() {
  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-16">
      <h1 className="text-xl font-semibold">This shop isn&apos;t available</h1>
      <p className="text-sm text-muted-foreground">
        The link may be wrong, or the shop&apos;s page is not currently published. Please check with the shop directly.
      </p>
      <Link href="/" className={buttonVariants({ variant: "outline" })}>
        Back to NationX
      </Link>
    </div>
  );
}
