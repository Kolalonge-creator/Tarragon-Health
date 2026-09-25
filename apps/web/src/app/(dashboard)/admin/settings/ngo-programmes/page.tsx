import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import {
  listFundingProgrammesForCaller,
  getFundingProgrammeStats,
  type FundingProgrammeStats,
} from "@/lib/ngo/funding-programmes";
import { PageHeader } from "@/components/ui/page-header";
import { NgoProgrammesManager } from "./ngo-programmes-manager";

export const metadata = { title: "NGO-funded programmes" };

/**
 * Superadmin-only console for the ngo_funded_cohort module (PR #713,
 * 2026-09-23) -- creates a funding_programmes row against a real, signed
 * NGO/PHC/government partnership and changes its status. Everything here is
 * a thin form over the existing RPCs (see apps/web/src/lib/ngo/funding-
 * programmes.ts); the RPCs are the real authority (private.is_admin(),
 * org-must-be-ngo, product-must-be-active-NGN, the module-enabled gate) --
 * this page only needs a signed-in superadmin to render, matching every
 * other admin/settings page's guard shape.
 *
 * The ngo_admin's OWN self-serve console (invite roster, invitation list,
 * revoke) lives at /ngo, not here -- programme creation stays superadmin-
 * only because it represents a real signed contract, not something an NGO
 * partner should be able to self-provision.
 */
export default async function NgoProgrammesPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/admin");

  const supabase = await createClient();

  const [{ data: ngoOrgs }, { data: products }, programmes] = await Promise.all([
    supabase.from("organisations").select("id, name").eq("type", "ngo").order("name"),
    supabase
      .from("service_products")
      .select("id, name, code, price_kobo")
      .eq("is_active", true)
      .eq("currency", "NGN")
      .order("name"),
    listFundingProgrammesForCaller(supabase),
  ]);

  const stats = new Map<string, FundingProgrammeStats>();
  await Promise.all(
    programmes.map(async (p) => {
      try {
        stats.set(p.id, await getFundingProgrammeStats(supabase, p.id));
      } catch {
        // A stats failure must never block the page from rendering the
        // programme list itself -- the manager shows "—" for that row
        // instead of a confident-but-wrong count.
      }
    })
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="NGO-funded programmes"
        description="A funded cohort for a real, signed NGO/PHC/government partnership — see docs/FUNDING_STRATEGY.md for how these are sold. Creating one here does not notify anyone; the programme's own ngo_admin invites their roster from /ngo once it's active."
      />
      <NgoProgrammesManager
        ngoOrganisations={ngoOrgs ?? []}
        products={products ?? []}
        programmes={programmes}
        stats={Object.fromEntries(stats)}
      />
    </div>
  );
}
