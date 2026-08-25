import { OutreachWorklist } from "@/components/clinical/outreach-worklist";

/** Excludes the awaiting_result trigger — that has its own Follow-ups tab
 * since self-arranged fulfilment gives it a different action set (remind,
 * don't book) and no priority to filter on. */
export default function CareCoordinatorOutreachPage() {
  return <OutreachWorklist excludeTriggerTypes={["awaiting_result"]} />;
}
