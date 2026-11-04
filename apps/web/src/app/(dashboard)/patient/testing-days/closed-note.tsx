import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";

/**
 * T2-02 (2026-11-04): Tarragon-run public testing days are closed to new bookings. Said plainly, with where the yearly tests happen
 * now: any reputable laboratory, paid directly, with the report uploaded for a doctor to review. No price is shown, because the
 * laboratory sets it.
 */
export function TestingDaysClosedNote() {
  return (
    <Card>
      <CardContent className="space-y-3 pt-6" data-testid="testing-days-closed">
        <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">We are not taking new bookings for Tarragon testing days.</p>
        <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">
          You can do your yearly tests at any reputable laboratory near you. Download a lab request form, take it to the laboratory and pay
          them directly (contact the laboratory for current pricing). Then upload the report: a doctor reviews it and it is kept in your
          health record with your trends.
        </p>
        <Link href="/patient/labs" className="inline-flex min-h-11 items-center text-sm font-medium text-brand-green underline">
          Get a lab request form
        </Link>
      </CardContent>
    </Card>
  );
}
