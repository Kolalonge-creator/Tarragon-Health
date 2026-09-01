import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPermission } from "@/lib/auth/permissions";
import { DoctorRetentionPoolManager } from "./doctor-retention-pool-manager";

export const metadata = { title: "Doctor retention pool" };

/**
 * Diaspora-funded retention top-ups for domestic clinical staff — data model
 * and admin record-keeping only. No payment collection or payroll automation
 * happens here: a pledge is recorded once its funds are confirmed received
 * off-platform, and a disbursement is an admin attestation that a top-up was
 * paid through the org's normal payroll process, not a money-movement event.
 * See 20260901191500_doctor_retention_pool_schema.sql for the full reasoning.
 */
export default async function DoctorRetentionPoolPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const allowed = profile.role === "admin" || (await hasPermission("doctor_retention_pool.manage"));
  if (!allowed) redirect("/admin");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Doctor retention pool
        </h1>
        <p className="pt-1 text-sm text-charcoal-ink/70">
          Diaspora sponsors can earmark hard-currency (GBP/USD) funds specifically to top up
          domestic clinical staff, as a retention lever against emigration. Record a pledge once
          its funds are actually confirmed received off-platform, then allocate it to a named
          clinical staff member for a named period. Disbursement is recorded here as an admin
          attestation once the top-up is paid through the org&apos;s normal payroll process
          outside the platform — this page never moves money itself.
        </p>
      </div>
      <DoctorRetentionPoolManager />
    </div>
  );
}
