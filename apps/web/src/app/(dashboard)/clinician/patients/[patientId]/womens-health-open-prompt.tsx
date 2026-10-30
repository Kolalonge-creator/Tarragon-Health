import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";

/** The query value that opens the Women's Health record. Only a deliberate open (a link or a typed URL) loads, and so audits, the record. */
export const WOMENS_HEALTH_TAB = "womens-health";

/**
 * OQ-555 (INV-10): the Women's Health tab is always in the tab list, but the record behind it is only read, and so only audited, when the clinician
 * chooses to open it. Rendering the audited panel on every chart load would write an "opened" row (or a refusal) each time a female patient's chart was
 * merely visited, and the patient's "who opened my record" list would then show openings that never happened.
 */
export function WomensHealthOpenPrompt({ patientId }: { patientId: string }) {
  return (
    <Card variant="soft">
      <CardContent className="space-y-3 py-4 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
        <p>Opening this record is written to the audit log, and the patient can see that you opened it.</p>
        <Link
          href={`/clinician/patients/${patientId}?tab=${WOMENS_HEALTH_TAB}`}
          className="inline-block rounded-md border border-charcoal-ink/20 px-3 py-1.5 font-medium text-deep-forest hover:bg-charcoal-ink/5"
        >
          Open the Women&apos;s Health record
        </Link>
      </CardContent>
    </Card>
  );
}
