import Link from "next/link";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { MessagesFlow } from "../messages-flow";

export default async function MessagesPage() {
  // Resolved the same way as every other /patient/* section (and the way
  // your-care-team.tsx links here) so a supporter acting for someone sees
  // and sends THAT person's messages, not their own — see the acting-for bug
  // fixed alongside this route in the 2026-09-01 patient dashboard audit.
  const { subjectId } = await getPatientDashboardContext();

  return (
    <DashboardPlaceholder greeting="Messages" roleLabel="Patient" comingUp={[]}>
      <div className="flex justify-end">
        <Link href="/patient" className="text-sm font-medium text-brand-green dark:text-brand-green-bright hover:underline">
          ← Back to dashboard
        </Link>
      </div>
      <p className="max-w-2xl text-sm text-charcoal-ink/70 dark:text-night-ink/70">
        Message your care team in the app and they&apos;ll reply here. For anything urgent, use the
        emergency options on your dashboard rather than a message.
      </p>
      <MessagesFlow patientId={subjectId} />
    </DashboardPlaceholder>
  );
}
