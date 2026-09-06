import type { ReactNode } from "react";
import Link from "next/link";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { ConditionsList } from "@/components/patient/conditions-list";
import { AllergiesList } from "@/components/patient/allergies-list";
import { VitalsTrendChart } from "@/components/vitals-trend-chart";
import { LabResults } from "@/app/(dashboard)/patient/lab-results";
import { WeeklyPlanCard } from "@/app/(dashboard)/patient/weekly-plan-card";
import { CareScheduleCard } from "@/app/(dashboard)/patient/care-schedule-card";
import { YourReferrals } from "@/components/your-referrals";
import { BariatricReferralStatus } from "@/app/(dashboard)/patient/weight-management/bariatric-referral-status";
import { PreventionCompletionCard } from "@/app/(dashboard)/patient/prevention-completion-card";
import { Card, CardContent } from "@/components/ui/card";

function SectionHeading({ children }: { children: ReactNode }) {
  return <h2 className="font-heading text-lg font-semibold text-charcoal-ink dark:text-night-ink">{children}</h2>;
}

/**
 * "Everything about me" view (spec §76.3 "personal health summary") --
 * conditions, medications, allergies, recent measurements, recent
 * investigations, care programmes, appointments, referrals, and preventive
 * tasks in one place, closing the gap that today these live scattered
 * across many separate pages with no single view. Pure composition over
 * already-RLS'd components/queries: ConditionsList/AllergiesList are the
 * only genuinely new reads on this page (patient_conditions/
 * patient_allergies had no reader anywhere in the app before this) --
 * everything else reuses an existing card, or links out to its own dedicated
 * page rather than rebuilding it here.
 *
 * Those cards self-hide when empty, which is right where they sit among
 * other content but wrong here: this page heads each one itself, so a new
 * patient met six headings with nothing under any of them and no way to tell
 * an empty record from a half-finished page. Each now takes an `emptyHint`
 * and answers its own heading with one muted line. The two that already
 * carry their own empty state (AllergiesList, VitalsTrendChart) are left
 * alone, and Medications is a static link card that is never empty.
 */
export default async function HealthSummaryPage() {
  const { subjectId } = await getPatientDashboardContext();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Your health summary"
        icon={SEMANTIC_ICON.carePlan}
        description="Everything about your care in one place: conditions, medicines, allergies, recent readings, investigations, care programmes, appointments, referrals, and what's still outstanding."
      />

      <div className="space-y-3">
        <SectionHeading>Conditions</SectionHeading>
        <ConditionsList
          patientId={subjectId}
          emptyHint="Nothing on file yet. Your care team adds a condition here once it has been confirmed."
        />
      </div>

      <div className="space-y-3">
        <SectionHeading>Allergies</SectionHeading>
        <AllergiesList patientId={subjectId} />
      </div>

      <div className="space-y-3">
        <SectionHeading>Medications</SectionHeading>
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
              Today&apos;s doses and your full medicines cabinet.
            </p>
            <Link
              href="/patient/medications"
              className="shrink-0 text-sm font-medium text-brand-green dark:text-brand-green-bright hover:underline"
            >
              See your medications
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <SectionHeading>Recent measurements</SectionHeading>
        <VitalsTrendChart patientId={subjectId} />
      </div>

      <div className="space-y-3">
        <SectionHeading>Recent investigations</SectionHeading>
        <LabResults
          patientId={subjectId}
          emptyHint="Nothing on file yet. Results appear here once a lab report has been reviewed."
        />
        <Link
          href="/patient/labs"
          className="inline-block text-sm font-medium text-brand-green dark:text-brand-green-bright hover:underline"
        >
          See all labs &amp; bookings
        </Link>
      </div>

      <div className="space-y-3">
        <SectionHeading>Care programmes</SectionHeading>
        <WeeklyPlanCard
          patientId={subjectId}
          emptyHint="You are not on a care programme at the moment. Your weekly plan shows up here when you join one."
        />
      </div>

      <div className="space-y-3">
        <SectionHeading>Appointments</SectionHeading>
        <CareScheduleCard
          patientId={subjectId}
          emptyHint="Nothing booked yet. Anything coming up shows here."
        />
        <Link
          href="/patient/appointments"
          className="inline-block text-sm font-medium text-brand-green dark:text-brand-green-bright hover:underline"
        >
          Book or manage an appointment
        </Link>
      </div>

      <div className="space-y-3">
        <SectionHeading>Referrals</SectionHeading>
        <YourReferrals
          patientId={subjectId}
          emptyHint="No specialist referrals on file yet."
        />
        <BariatricReferralStatus patientId={subjectId} />
      </div>

      <div className="space-y-3">
        <SectionHeading>Preventive tasks</SectionHeading>
        <PreventionCompletionCard
          patientId={subjectId}
          emptyHint="Nothing outstanding yet. Fill in your health profile and your screening and vaccination calendar appears here."
        />
      </div>
    </div>
  );
}
