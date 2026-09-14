import { redirect, notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { BiologicalAgeTrendClient } from "./biological-age-trend-client";

/**
 * Full trend view for the Biological Age estimate — reached from "See your
 * trend over time" on BiologicalAgeCard. Same auth/redirect shape as
 * /patient/weight; no entitlement gate, since the Biological Age card it's
 * reached from has none either (it's a reframe of the same free-tier-visible
 * Health Score).
 *
 * Server-side gated on the same `biological_age_card` feature flag the
 * dashboard card checks (see biological-age-card.tsx's module doc for why —
 * default off, pending real clinical sign-off). The card hiding its own link
 * is not sufficient on its own: this route would otherwise still be directly
 * reachable by URL while the feature is meant to be off.
 */
export default async function BiologicalAgePage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.onboarding_completed_at) redirect("/onboarding");

  const supabase = await createClient();
  const { data: flags } = await supabase.rpc("my_feature_flags");
  const isEnabled = (flags as Record<string, boolean> | null)?.biological_age_card === true;
  if (!isEnabled) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Biological age"
        icon={SEMANTIC_ICON.preventive}
        backTo={{ href: "/patient", label: "Overview" }}
        description="How your estimate has moved over time, alongside your birth age for context."
      />
      <BiologicalAgeTrendClient patientId={profile.id} />
    </div>
  );
}
