import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SEMANTIC_ICON } from "@/lib/icons";

/**
 * Ungated since removal 4 (20260729143514). This used to be the Family Plan's
 * shared-household view and only rendered behind
 * RequiresEntitlement('family_dashboard'); naming a next of kin and keeping a
 * young child's record are not things a person should have to buy.
 */
export function CareCircleCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.family className="h-5 w-5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} aria-hidden />
          Your people
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          Name a next of kin we can reach if something urgent comes up, and keep your children&apos;s
          vaccination cards alongside your own.
        </p>
        <Button asChild size="sm" variant="outline">
          <Link href="/patient/family">Open</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
