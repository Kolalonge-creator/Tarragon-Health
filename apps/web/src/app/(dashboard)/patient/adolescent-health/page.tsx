import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { adolescentAgeBandFromDateOfBirth } from "@tarragon/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ICON } from "@/lib/icons";
import { AdolescentHealthForm } from "./adolescent-health-form";

const TRANSITION_STAGE_LABEL: Record<string, string> = {
  transition_assessment: "Transition assessment",
  independent_account_prep: "Independent account preparation",
  health_literacy: "Health literacy",
  medication_independence: "Medication independence",
  adult_care_handoff: "Adult care",
};
const TRANSITION_STAGES = Object.keys(TRANSITION_STAGE_LABEL);

/**
 * Adolescent Health module home (spec §49) — the psychosocial check-in
 * (§49.5/§49.6) plus, for the older-adolescent band, a view of the
 * transition-to-adult-care plan (§49.12). Age-aware framing only
 * (§49.3): adolescentAgeBandFromDateOfBirth mirrors, but does not replace,
 * the real DB-side gate in private.adolescent_age_band — a patient outside
 * the adolescent bands sees an explanatory note instead of the form, but
 * nothing here is a security boundary.
 */
export default async function AdolescentHealthPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const ageBand = adolescentAgeBandFromDateOfBirth(profile.date_of_birth);
  const supabase = await createClient();

  const [{ data: lastScreen }, { data: transitionPlan }] = await Promise.all([
    supabase
      .from("adolescent_psychosocial_screens")
      .select("created_at, reviewed_at")
      .eq("patient_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("adolescent_transition_plans")
      .select("current_stage, started_at, target_transition_age")
      .eq("patient_id", profile.id)
      .maybeSingle(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Adolescent Health"
        icon={NAV_ICON.review}
        backTo={{ href: "/patient", label: "Dashboard" }}
        description="A private, whole-life check-in — home, school, activity, and how you're really doing — plus your path toward looking after your own care as you get older."
      />

      {(ageBand === "younger_adolescent" || ageBand === "older_adolescent") && lastScreen && (
        <Card variant="soft">
          <CardContent className="flex items-center justify-between py-4 text-sm text-charcoal-ink/80">
            <span>
              Last check-in:{" "}
              {new Date(lastScreen.created_at).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
            <Badge variant={lastScreen.reviewed_at ? "green" : "amber"}>
              {lastScreen.reviewed_at ? "Reviewed by your care team" : "Awaiting review"}
            </Badge>
          </CardContent>
        </Card>
      )}

      {transitionPlan && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your path to adult care</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-charcoal-ink/80">
            <p>
              We plan to move your care fully into your own hands by around age{" "}
              {transitionPlan.target_transition_age}. Your care team will walk you through this
              gradually — there&apos;s nothing to do here yourself yet.
            </p>
            <ol className="flex flex-wrap gap-2 pt-1">
              {TRANSITION_STAGES.map((stage) => {
                const isCurrent = stage === transitionPlan.current_stage;
                return (
                  <li key={stage}>
                    <Badge variant={isCurrent ? "green" : "grey"}>{TRANSITION_STAGE_LABEL[stage]}</Badge>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      )}

      {ageBand === "younger_adolescent" || ageBand === "older_adolescent" ? (
        <AdolescentHealthForm />
      ) : (
        <Card variant="soft">
          <CardContent className="py-4 text-sm text-charcoal-ink/70">
            {ageBand === "child"
              ? "This check-in is designed for older children and teenagers to complete themselves. It isn't the right place to log something on behalf of a younger child."
              : "This particular check-in is designed for the adolescent years. Your care team's regular wellbeing check-ins cover this for you."}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
