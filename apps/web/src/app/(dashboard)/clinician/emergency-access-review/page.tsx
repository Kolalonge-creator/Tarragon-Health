import { getCurrentProfile, getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmergencyAccessReviewQueue } from "./emergency-access-review-queue";

/**
 * Reviews break-glass cross-organisation access: who requested it, why, and
 * whether it was legitimate. Restricted to the patient's own home-org
 * clinical director (or an admin) -- not /admin/, because is_clinical_director
 * is an org-scoped attribute on clinical_staff, not a platform role, and an
 * admin-rooted route would exclude the actual primary reviewer. This is a UI
 * courtesy: review_emergency_record_access() enforces the same boundary
 * server-side regardless of what this page shows.
 */
export default async function EmergencyAccessReviewPage() {
  const profile = await getCurrentProfile();
  const staff = await getCurrentClinicalStaff();
  const canReview = profile?.role === "admin" || staff?.doctor_tier === "chief_medical_officer";

  if (!canReview) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Emergency access review</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-charcoal-ink/60">
            Reviewing emergency access is restricted to your organisation&apos;s clinical director.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Emergency access review
        </h1>
        <p className="text-charcoal-ink/60">
          When a clinician outside your organisation opens one of your patients&apos; records in an
          emergency, it happens immediately -- there is no waiting for approval first -- but every
          request lands here afterwards for you to confirm it was legitimate. The requester cannot
          review their own request.
        </p>
      </div>
      <EmergencyAccessReviewQueue />
    </div>
  );
}
