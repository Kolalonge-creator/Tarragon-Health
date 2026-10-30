import { OutreachWorklist } from "@/components/clinical/outreach-worklist";
import { CareGapSection } from "@/components/clinical/care-gap-section";

/** Excludes the awaiting_result trigger — that has its own Follow-ups tab
 * since self-arranged fulfilment gives it a different action set (remind,
 * don't book) and no priority to filter on. The care gaps assigned to this
 * coordinator (S90) sit above the worklist, each with its "why this gap is
 * open" panel. */
export default function CareCoordinatorOutreachPage() {
  return (
    <div className="space-y-6">
      <CareGapSection />
      <OutreachWorklist excludeTriggerTypes={["awaiting_result"]} />
    </div>
  );
}
