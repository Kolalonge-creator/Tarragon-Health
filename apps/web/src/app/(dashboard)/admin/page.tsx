import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";

export default async function AdminPage() {
  const profile = await getCurrentProfile();

  const { isSuperAdmin, keys } = await getCallerPermissions();
  const canManageUsers =
    isSuperAdmin ||
    keys.has("users.provision") ||
    keys.has("users.roles.assign") ||
    keys.has("users.permissions.grant") ||
    keys.has("roles.manage");
  const canManagePartners =
    isSuperAdmin ||
    ["partners.labs.manage", "partners.pharmacies.manage", "partners.facilities.manage", "partners.specialists.manage", "partners.home_visit.manage", "partners.logistics.manage"].some(
      (k) => keys.has(k)
    );
  const canViewAnalytics = isSuperAdmin || keys.has("analytics.view");
  // A member only sees an operational card if they can actually use that surface.
  // Cards with no dedicated capability key stay super-admin-only.
  const can = (key: string) => isSuperAdmin || keys.has(key);

  return (
    <DashboardPlaceholder
      greeting={`Welcome${profile?.full_name ? `, ${profile.full_name}` : ""}`}
      roleLabel={isSuperAdmin ? "Super Admin" : "Admin"}
      comingUp={[
        "Users, orgs, system health (API latency, WhatsApp delivery, ML status)",
        "Finance: MRR/ARR/churn/commission/receivables",
        "ML model versioning + batch re-scoring trigger",
        "Audit trail + NDPR export/erasure tools",
      ]}
    >
      {canManageUsers && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SEMANTIC_ICON.family className="h-5 w-5 text-deep-forest" strokeWidth={2} />
              <Link href="/admin/settings/members" className="hover:underline">
                Members &amp; access
              </Link>
            </CardTitle>
            <CardDescription>
              Create logins for employees and partners, assign roles, build custom roles, and
              delegate specific capabilities to individual members.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/admin/settings/members" className="text-sm font-medium text-brand-green hover:underline">
              Manage members &amp; access →
            </Link>
          </CardContent>
        </Card>
      )}

      {canManagePartners && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SEMANTIC_ICON.labs className="h-5 w-5 text-deep-forest" strokeWidth={2} />
              <Link href="/admin/settings/partners" className="hover:underline">
                Partners
              </Link>
            </CardTitle>
            <CardDescription>
              Add and manage the partner network — labs, pharmacies, hospitals, specialists, and
              logistics.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/admin/settings/partners" className="text-sm font-medium text-brand-green hover:underline">
              Manage partners →
            </Link>
          </CardContent>
        </Card>
      )}

      {canViewAnalytics && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SEMANTIC_ICON.corporate className="h-5 w-5 text-deep-forest" strokeWidth={2} />
              <Link href="/analytics" className="hover:underline">
                Platform analytics
              </Link>
            </CardTitle>
            <CardDescription>
              Company-wide business, financial, and population-health intelligence across every
              organisation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/analytics" className="text-sm font-medium text-brand-green hover:underline">
              Open analytics console →
            </Link>
          </CardContent>
        </Card>
      )}

      {isSuperAdmin && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SEMANTIC_ICON.bp className="h-5 w-5 text-deep-forest" strokeWidth={2} />
            <Link href="/admin/settings/vitals-reminders" className="hover:underline">
              Vitals reminder cadence
            </Link>
          </CardTitle>
          <CardDescription>
            Set how often patients are nudged to log vitals — globally, per condition, or
            per patient.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/admin/settings/vitals-reminders"
            className="text-sm font-medium text-brand-green hover:underline"
          >
            Manage reminder settings →
          </Link>
        </CardContent>
      </Card>
      )}

      {isSuperAdmin && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SEMANTIC_ICON.medication className="h-5 w-5 text-deep-forest" strokeWidth={2} />
            <Link href="/admin/settings/medication-refills" className="hover:underline">
              Medication refill reminders
            </Link>
          </CardTitle>
          <CardDescription>
            Set how many days before a refill date patients get reminded — globally or per
            patient.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/admin/settings/medication-refills"
            className="text-sm font-medium text-brand-green hover:underline"
          >
            Manage refill settings →
          </Link>
        </CardContent>
      </Card>
      )}

      {can("partners.facilities.manage") && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SEMANTIC_ICON.corporate className="h-5 w-5 text-deep-forest" strokeWidth={2} />
            <Link href="/admin/facilities" className="hover:underline">
              Facility directory
            </Link>
          </CardTitle>
          <CardDescription>
            Add facilities patients can browse and request bookings from, and manage what each
            one offers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/admin/facilities"
            className="text-sm font-medium text-brand-green hover:underline"
          >
            Manage facilities →
          </Link>
        </CardContent>
      </Card>
      )}

      {isSuperAdmin && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SEMANTIC_ICON.booking className="h-5 w-5 text-deep-forest" strokeWidth={2} />
            <Link href="/admin/bookings" className="hover:underline">
              Booking requests
            </Link>
          </CardTitle>
          <CardDescription>
            See every facility booking request patients have submitted and update its status.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/admin/bookings"
            className="text-sm font-medium text-brand-green hover:underline"
          >
            View booking requests →
          </Link>
        </CardContent>
      </Card>
      )}

      {isSuperAdmin && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SEMANTIC_ICON.aiCoach className="h-5 w-5 text-deep-forest" strokeWidth={2} />
            <Link href="/admin/settings/ai-coach" className="hover:underline">
              AI Health Coach (internal testing)
            </Link>
          </CardTitle>
          <CardDescription>
            Try the AI Coach yourself before it&apos;s released to patients — it&apos;s gated to
            admins only until a subscription plan lists the ai_coach feature.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/admin/settings/ai-coach"
            className="text-sm font-medium text-brand-green hover:underline"
          >
            Try the coach →
          </Link>
        </CardContent>
      </Card>
      )}

      {can("clinical_staff.manage") && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SEMANTIC_ICON.clinicianFollowUp className="h-5 w-5 text-deep-forest" strokeWidth={2} />
            <Link href="/admin/settings/clinical-staff" className="hover:underline">
              Clinical staff
            </Link>
          </CardTitle>
          <CardDescription>
            Add and verify every named Clinical Director, care team doctor, and escalation doctor —
            a record can&apos;t go active until its MDCN/NMCN credential is verified.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/admin/settings/clinical-staff"
            className="text-sm font-medium text-brand-green hover:underline"
          >
            Manage clinical staff →
          </Link>
        </CardContent>
      </Card>
      )}

      {can("protocols.manage") && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SEMANTIC_ICON.preventive className="h-5 w-5 text-deep-forest" strokeWidth={2} />
            <Link href="/admin/settings/protocols" className="hover:underline">
              Clinical protocols
            </Link>
          </CardTitle>
          <CardDescription>
            The version-signed record behind every &quot;protocols supervised by Dr. X&quot;
            claim shown to patients. Only the org&apos;s active Clinical Director can sign.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/admin/settings/protocols"
            className="text-sm font-medium text-brand-green hover:underline"
          >
            Manage protocols →
          </Link>
        </CardContent>
      </Card>
      )}

      {can("conditions.manage") && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SEMANTIC_ICON.carePlan className="h-5 w-5 text-deep-forest" strokeWidth={2} />
            <Link href="/admin/settings/conditions" className="hover:underline">
              Chronic conditions
            </Link>
          </CardTitle>
          <CardDescription>
            The phased chronic-disease catalogue. Launch with hypertension and diabetes; activate
            asthma, COPD, heart failure, CKD and obesity as the programme scales. Each needs a
            signed WHO protocol before it can go live.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/admin/settings/conditions"
            className="text-sm font-medium text-brand-green hover:underline"
          >
            Manage conditions →
          </Link>
        </CardContent>
      </Card>
      )}

      {can("health_education.manage") && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SEMANTIC_ICON.preventive className="h-5 w-5 text-deep-forest" strokeWidth={2} />
            <Link href="/admin/settings/health-education" className="hover:underline">
              Health education library
            </Link>
          </CardTitle>
          <CardDescription>
            The clinician-reviewed learning catalogue surfaced to patients, personalised to their
            conditions and risk. Publish or hide articles and videos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/admin/settings/health-education"
            className="text-sm font-medium text-brand-green hover:underline"
          >
            Manage library →
          </Link>
        </CardContent>
      </Card>
      )}

      {can("subscriptions.manage") && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SEMANTIC_ICON.billing className="h-5 w-5 text-deep-forest" strokeWidth={2} />
            <Link href="/admin/settings/subscriptions" className="hover:underline">
              Subscription plans &amp; add-ons
            </Link>
          </CardTitle>
          <CardDescription>
            Create, price, and activate patient plans and add-on services — synced to Paystack
            automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/admin/settings/subscriptions"
            className="text-sm font-medium text-brand-green hover:underline"
          >
            Manage plans &amp; add-ons →
          </Link>
        </CardContent>
      </Card>
      )}

      {can("commissions.view") && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SEMANTIC_ICON.commission className="h-5 w-5 text-deep-forest" strokeWidth={2} />
            <Link href="/admin/settings/commissions" className="hover:underline">
              Commission tracking
            </Link>
          </CardTitle>
          <CardDescription>
            Every lab, pharmacy, and specialist-referral commission Tarragon has earned from its
            partner network, and what&apos;s still owed vs. paid.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/admin/settings/commissions"
            className="text-sm font-medium text-brand-green hover:underline"
          >
            View commissions →
          </Link>
        </CardContent>
      </Card>
      )}

      {(can("partners.home_visit.manage") || can("partners.logistics.manage")) && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SEMANTIC_ICON.logistics className="h-5 w-5 text-deep-forest" strokeWidth={2} />
            <Link href="/admin/settings/logistics-partners" className="hover:underline">
              Home visit &amp; delivery partners
            </Link>
          </CardTitle>
          <CardDescription>
            Add or activate a home-collection or delivery partner for a region — this is what
            turns on real scheduling/tracking for patients there instead of &quot;coming soon&quot;.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/admin/settings/logistics-partners"
            className="text-sm font-medium text-brand-green hover:underline"
          >
            Manage partners →
          </Link>
        </CardContent>
      </Card>
      )}

      {can("broadcasts.send") && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SEMANTIC_ICON.clinicianFollowUp className="h-5 w-5 text-deep-forest" strokeWidth={2} />
            <Link href="/admin/settings/broadcasts" className="hover:underline">
              Broadcasts &amp; announcements
            </Link>
          </CardTitle>
          <CardDescription>
            Send an email/WhatsApp/SMS announcement to a targeted audience — all patients,
            a state, subscribers on a plan, all partners, or a partner group.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/admin/settings/broadcasts"
            className="text-sm font-medium text-brand-green hover:underline"
          >
            Compose broadcast →
          </Link>
        </CardContent>
      </Card>
      )}

      {can("service_regions.manage") && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SEMANTIC_ICON.corporate className="h-5 w-5 text-deep-forest" strokeWidth={2} />
            <Link href="/admin/settings/service-regions" className="hover:underline">
              Service regions (state rollout)
            </Link>
          </CardTitle>
          <CardDescription>
            Turn TarragonHealth on one state at a time. Activating a state opens its partner
            actions and automatically notifies everyone waiting there.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/admin/settings/service-regions"
            className="text-sm font-medium text-brand-green hover:underline"
          >
            Manage regions →
          </Link>
        </CardContent>
      </Card>
      )}
    </DashboardPlaceholder>
  );
}
