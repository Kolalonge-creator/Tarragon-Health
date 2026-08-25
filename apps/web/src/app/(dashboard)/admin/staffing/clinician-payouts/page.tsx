import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { PayoutsManager } from "./payouts-manager";

/**
 * The real, working "way to pay a doctor" — Tier 4 (Senior Registrar) and
 * Tier 5 (Partner Specialist) are contracted/per-consult
 * (docs/Tarragon_Health_Master_Operating_Plan_v4.md §4/§8); this is where
 * what the platform owes them for completed video visits becomes an actual
 * payable, not just a business-plan sentence. It plugs into the existing
 * accounts-payable machinery (finance_vendors/finance_bills) rather than a
 * new payment rail — settle rolls accrued fees into a bill, then the
 * existing WHT-aware approve/pay lifecycle takes over.
 */
export default async function ClinicianPayoutsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.organisation_id) redirect("/admin");

  const { isSuperAdmin, keys } = await getCallerPermissions();
  if (!isSuperAdmin && !keys.has("finance.vendors.manage")) redirect("/admin");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Contracted clinician payouts
        </h1>
        <p className="text-charcoal-ink/60">
          Per-consult fees owed to Tier 4/5 contracted doctors for completed video visits.
          Tiers 1-3 are salaried and never appear here.
        </p>
      </div>
      <PayoutsManager />
    </div>
  );
}
