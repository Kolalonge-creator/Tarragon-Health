import { OutreachWorklist } from "@/components/clinical/outreach-worklist";
import { CareGapSection } from "@/components/clinical/care-gap-section";

export default function ClinicianOutreachPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Outreach</h1>
        <p className="text-sm text-charcoal-ink/60">
          Proactive outreach tasks to close panel gaps.
        </p>
      </div>
      <CareGapSection />
      <OutreachWorklist />
    </div>
  );
}
