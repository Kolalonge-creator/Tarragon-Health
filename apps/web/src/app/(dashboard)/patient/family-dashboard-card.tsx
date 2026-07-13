import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SEMANTIC_ICON } from "@/lib/icons";

/** Only rendered when RequiresEntitlement('family_dashboard') passes — see page.tsx. */
export function FamilyDashboardCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.family className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Family dashboard
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-charcoal-ink/70">
          See everyone on your Family Plan in one shared view.
        </p>
        <Button asChild size="sm" variant="outline">
          <Link href="/patient/family">Open family dashboard</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
