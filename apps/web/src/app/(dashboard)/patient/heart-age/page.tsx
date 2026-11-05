import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { HeartAgeTrendClient } from "./heart-age-trend-client";

/**
 * Full trend view for Heart Age — reached from "See your trend over time" on
 * HeartAgeCard. Same auth/redirect shape as /patient/weight; no entitlement
 * gate, since the card it's reached from has none either.
 *
 * Server-side gated on the same `heart_age_card` feature flag the dashboard
 * card checks (see heart-age-card.tsx's module doc — default off, pending
 * real clinical sign-off). The card hiding its own link is not sufficient on
 * its own: this route would otherwise still be directly reachable by URL
 * while the feature is meant to be off.
 */
export default async function HeartAgePage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.onboarding_completed_at) redirect("/onboarding");

  const supabase = await createClient();
  const { data: flags } = await supabase.rpc("my_feature_flags");
  const isEnabled = (flags as Record<string, boolean> | null)?.heart_age_card === true;
  // Off until a Clinical Director signs the estimate off. A plain notice rather than a 404: the address is on the Home card's
  // link and in old notifications, and a "page not found" reads as a broken app.
  if (!isEnabled) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Heart age"
          icon={SEMANTIC_ICON.preventive}
          backTo={{ href: "/patient", label: "Overview" }}
          description="An estimate of how your heart's risk compares with your actual age."
        />
        <p className="rounded-2xl border border-charcoal-ink/10 bg-white p-5 text-sm text-charcoal-ink/70 dark:border-night-ink/15 dark:bg-night-card dark:text-night-ink/70">
          Heart age is not switched on for your account yet. Your health by area on the Overview shows the same everyday numbers in
          the meantime.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Heart age"
        icon={SEMANTIC_ICON.preventive}
        backTo={{ href: "/patient", label: "Overview" }}
        description="How your estimate has moved over time, alongside your actual age for context."
      />
      <HeartAgeTrendClient patientId={profile.id} />
    </div>
  );
}
