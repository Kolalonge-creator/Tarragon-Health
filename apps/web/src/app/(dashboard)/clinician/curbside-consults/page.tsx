import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { isClinicalTier } from "@/lib/clinical/doctor-tier";
import { CurbsideConsultWorklist } from "./worklist";

/**
 * Doctor-to-doctor "curbside consult" — Master Operating Plan §4/§8's Senior
 * Medical Officer tier was otherwise unusually complete except for a
 * peer-to-peer channel for an informal clinical question. Every clinical
 * tier may use it EXCEPT Care Coordinator (not a clinical role, per
 * private.enforce_curbside_consult_thread) — mirrors the friendly-message
 * pattern used by canAssignCases-gated pages rather than a hard redirect,
 * since the underlying gate is enforced in the database regardless.
 */
export default async function CurbsideConsultsPage() {
  const staff = await getCurrentClinicalStaff();

  if (!staff || !isClinicalTier(staff)) {
    return (
      <div className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Curbside consults</h1>
        <p className="text-sm text-charcoal-ink/60">
          Curbside consults are a doctor-to-doctor channel, not available to this role.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Curbside consults</h1>
        <p className="text-sm text-charcoal-ink/60">
          Ask a colleague a quick clinical question — informal, doctor-to-doctor, and not part of
          the patient&apos;s chart.
        </p>
      </div>
      <CurbsideConsultWorklist myClinicalStaffId={staff.id} />
    </div>
  );
}
