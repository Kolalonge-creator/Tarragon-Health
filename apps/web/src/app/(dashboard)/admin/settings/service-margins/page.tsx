import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { ServiceMarginsClient } from "./margins-client";

/**
 * What each paid service earns, and the clinician rates that answer rests on.
 *
 * ADMIN, NOT CLINICIAN, AND DELIBERATELY. An earlier note described this as the
 * Chief Medical Officer's view. It is not: clinical_tier_cost_rates and
 * service_delivery_cost_model are gated on private.is_admin(), a CMO holds the
 * ordinary `clinician` account role and can never reach /admin/**, and what
 * this page shows is commercial rather than clinical — what a minute of
 * somebody's time costs the company. Widening the RLS to put it in front of the
 * clinical team would be a real decision about who sees pay data, not a
 * routing tweak, so it has not been made here.
 *
 * proxy.ts already blocks non-admins from /admin/**; the check below is
 * defence in depth, matching every other admin/settings page.
 */
export default async function ServiceMarginsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Service margins"
        icon={SEMANTIC_ICON.billing}
        description="What each paid service earns after the clinical time it takes and the payment fee. Laboratory pricing has always been guarded against selling below cost; doctor time was not, until this."
      />
      <ServiceMarginsClient />
    </div>
  );
}
