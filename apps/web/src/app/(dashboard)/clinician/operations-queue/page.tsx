import { OperationsQueueWorklist } from "./operations-queue-worklist";

/**
 * Operations & Command Centre §96.6/96.16/96.17 "clinical operations queue":
 * open clinician_alerts grouped into the spec's 4 categories, each row
 * carrying priority/age/owner/SLA/status -- the generic queue shape 96.16
 * asks for, built on the alert taxonomy that already carries all of it
 * (20260828014055_clinician_alerts_taxonomy_lifecycle_ownership.sql) rather
 * than a new schema. Every doctor tier can view/work this queue (unified
 * access, 2026-07-31) -- claiming/resolving an individual alert still goes
 * through the existing per-alert actions on ./[alertId] or the main
 * clinician inbox, this page is a categorised overview, not a new mutation
 * surface.
 */
export default function OperationsQueuePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Operations queue</h1>
        <p className="text-sm text-charcoal-ink/60">
          Open cases grouped by category, ranked by severity then SLA -- plus open care gaps for
          situational awareness (worked from the care-coordinator outreach queue, not here).
        </p>
      </div>
      <OperationsQueueWorklist />
    </div>
  );
}
