import { getCurrentProfile, getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { isClinicalTier } from "@/lib/clinical/doctor-tier";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SafetyIncidentsConsole } from "./safety-incidents-console";

export default async function SafetyIncidentsPage() {
  const [profile, staff] = await Promise.all([getCurrentProfile(), getCurrentClinicalStaff()]);

  if (!profile?.organisation_id) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Safety incidents</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-charcoal-ink/60">No organisation on this account.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Safety incidents</h1>
        <p className="text-sm text-charcoal-ink/60">
          Clinical incident and near-miss log — file one when something goes wrong or nearly does.
        </p>
      </div>
      <SafetyIncidentsConsole
        organisationId={profile.organisation_id}
        canReview={isClinicalTier(staff)}
      />
    </div>
  );
}
