import type { OpsDeskOverview } from "./schemas";

/** Pure: the sentence the readiness line shows, from the overview.  */
export function opsDeskReadinessText(o: OpsDeskOverview): { tone: "green" | "amber" | "red"; text: string } {
  const inPlace = o.checklist.filter((i) => i.state === "in_place" && !i.stale).length;
  const total = o.checklist.length;
  if (o.active_primary === 0 || o.active_deputy === 0) {
    return { tone: "red", text: `No named ops person${o.active_primary === 0 && o.active_deputy === 0 ? "" : o.active_primary === 0 ? " as primary" : " as deputy"}; ${inPlace} of ${total} resilience checks attested.` };
  }
  if (o.on_duty_now === 0) return { tone: "amber", text: `Nobody on duty at the ops desk right now; ${inPlace} of ${total} resilience checks attested.` };
  return { tone: inPlace === total ? "green" : "amber", text: `${o.on_duty_now} on duty at the ops desk; ${inPlace} of ${total} resilience checks attested.` };
}
