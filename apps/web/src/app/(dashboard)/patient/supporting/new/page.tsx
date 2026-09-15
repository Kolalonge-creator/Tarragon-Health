import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ICON } from "@/lib/icons";
import { BuyCareForSomeone } from "./buy-care-for-someone";

/**
 * The missing purchase page: buy a named service for someone in one flow,
 * whether they already use Tarragon or not.
 *
 * Before this page, "pay for someone's care" was two separate, undiscoverable
 * stops — set them up as family on /patient/family (elder-proxy form, for
 * someone not yet on Tarragon), then separately find "Pay for their plan" on
 * /patient/supporting once they showed up in the supported-people list. A
 * diaspora sponsor with a relative who has never touched Tarragon had no
 * single place that said "start here" and no way to go straight from "who is
 * this for" to "paid" in one sitting.
 *
 * This page does not invent a new beneficiary or payment primitive. It
 * sequences two that already exist and are already audited:
 *   1. addElderProxyDependentAction (patient/family/add-elder-actions.ts) —
 *      creates a login-less profile for a consenting adult who isn't on
 *      Tarragon yet, with its own phone-lookup safety check and required
 *      consent attestation, and grants the sponsor a 'manage' profile_access
 *      row immediately.
 *   2. paySomeonesPlan (patient/supporting/actions.ts) — buys any active,
 *      NGN-priced service_products row (which already includes the
 *      2026-09-10 Continuous Monitoring and Supervised Weight Management
 *      products, since that list is read generically, not hardcoded) for a
 *      beneficiary the caller holds a 'manage' grant over, via Paystack.
 * The Paystack callback lands back on /patient/supporting, which already
 * renders SponsorCareReport for every person the sponsor supports.
 */
export default async function BuyCareForSomeonePage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "patient") redirect("/");

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={{ href: "/patient/supporting", label: "People you support" }}
        title="Buy care for someone"
        icon={NAV_ICON.healthyAgeing}
        description="Pick someone you already support, or set up a record for a relative who isn't on Tarragon yet, then pay for a doctor's time or Continuous Monitoring on their behalf, in naira, via Paystack."
      />
      <BuyCareForSomeone />
    </div>
  );
}
