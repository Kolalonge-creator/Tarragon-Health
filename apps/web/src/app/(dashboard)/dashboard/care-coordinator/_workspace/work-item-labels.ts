import { TRIGGER_LABEL } from "@/components/clinical/outreach-worklist";
import { NAVIGATION_REQUEST_CATEGORY_LABEL } from "@/lib/validation/navigation-requests";
import { TASK_TYPE_LABEL } from "@/lib/queue/task-types";
import type { WorkItem } from "@/lib/care-coordinator/work-items";

const PROGRAMME_LABEL: Record<string, string> = {
  missed_lab_panel: "Missed lab panel",
  missed_doctor_checkin: "Missed doctor check-in",
  lab_panel_due_soon: "Lab panel due soon",
};

/** The plain-language name of what the task is about. Unknown codes fall back to the code itself, readable but never hidden. */
export function workItemTitle(item: Pick<WorkItem, "source" | "kind">): string {
  const k = item.kind;
  switch (item.source) {
    case "outreach":
      return (TRIGGER_LABEL as Record<string, string>)[k] ?? k.replace(/_/g, " ");
    case "support":
      return `Help with ${((NAVIGATION_REQUEST_CATEGORY_LABEL as Record<string, string>)[k] ?? k).toLowerCase()}`;
    case "programme":
      return PROGRAMME_LABEL[k] ?? k.replace(/_/g, " ");
    case "queue":
      return TASK_TYPE_LABEL[k] ?? k.replace(/_/g, " ");
  }
}
