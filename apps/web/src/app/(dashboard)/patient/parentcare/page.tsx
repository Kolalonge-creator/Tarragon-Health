import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { FamilyMembersManager } from "@/app/(dashboard)/patient/family/family-members-manager";
import { YourCareTeam } from "@/components/your-care-team";
import { getFamilyPlanMembersServer } from "@/lib/queries/family-plan-members-server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SEMANTIC_ICON } from "@/lib/icons";

/**
 * ParentCare only — reuses FamilyMembersManager verbatim (it's already
 * plan-agnostic: phone + relationship, no hardcoded headcount) for the
 * "attach a parent" flow, per the shared family_plan_members mechanism.
 * Gated on an active ParentCare subscription specifically, not the generic
 * `family_dashboard` feature — that flag is shared with Family Lite/Plus/
 * Premium too, so it can't distinguish "is this caller a ParentCare
 * subscriber" on its own.
 */
export default async function ParentCarePage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }
  if (profile.role !== "patient") {
    redirect("/");
  }

  const supabase = await createClient();
  const { data: subscriptions } = await supabase
    .from("subscriptions")
    .select("plan:subscription_plans!subscriptions_plan_id_fkey!inner(code)")
    .eq("subscriber_id", profile.id)
    .in("status", ["active", "trialing"]);
  const isParentCareSubscriber = (subscriptions ?? []).some((s) => s.plan.code.startsWith("parentcare"));
  if (!isParentCareSubscriber) {
    redirect("/patient");
  }

  const parents = await getFamilyPlanMembersServer(supabase, profile.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">ParentCare</h1>
        <p className="text-charcoal-ink/60">
          Dedicated monitoring for up to 2 parents — a named doctor coordinator, scheduled doctor
          review, and a quarterly family report.
        </p>
      </div>

      <FamilyMembersManager />

      {parents.length > 0 && (
        <div className="space-y-4">
          <h2 className="font-heading text-lg font-semibold text-charcoal-ink">Their care team</h2>
          {parents.map((parent) => (
            <div key={parent.id}>
              <p className="mb-1 text-sm font-medium text-charcoal-ink">
                {parent.member?.full_name ?? "Your parent"}
              </p>
              <YourCareTeam patientId={parent.member_id} />
            </div>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SEMANTIC_ICON.labs className="h-5 w-5 text-deep-forest" strokeWidth={2} />
            Quarterly report
          </CardTitle>
          <CardDescription>
            A PDF summary of vitals, medication adherence, and preventive screenings, generated
            every quarter for your records.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild size="sm">
            <a href="/api/patient/quarterly-report/pdf">Download latest report</a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
