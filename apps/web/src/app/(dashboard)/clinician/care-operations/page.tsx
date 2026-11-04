import { CareOperationsPage } from "@/components/care-operations/care-operations-page";

export const metadata = { title: "Care operations" };
export const dynamic = "force-dynamic";

/** MSG-5: where the care team's work sits today. Any staff member of the organisation; the database function refuses anyone else. */
export default function ClinicianCareOperations() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Care operations</h1>
        <p className="text-sm text-charcoal-ink/60">
          What is waiting across patient messages, clinical alerts and monthly meetings, and who holds it. Updates every minute.
        </p>
      </div>
      <CareOperationsPage messagesHref="/clinician/messages" showDoctorLinks />
    </div>
  );
}
