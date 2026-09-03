import type { ReactNode } from "react";
import Link from "next/link";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
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
  return <h2 className="font-heading text-lg font-semibold text-charcoal-ink">{children}</h2>;
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
 * everything else reuses an existing, self-hiding card, or links out to its
 * own dedicated page rather than rebuilding it here.
 */
export default async function HealthSummaryPage() {
  const { subjectId } = await getPatientDashboardContext();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Your health summary
        </h1>
        <p className="text-sm text-charcoal-ink/60">
          Everything about your care in one place: conditions, medicines, allergies, recent
          readings, investigations, care programmes, appointments, referrals, and what&apos;s
          still outstanding.
        </p>
      </div>

      <div className="space-y-3">
        <SectionHeading>Conditions</SectionHeading>
        <ConditionsList patientId={subjectId} />
      </div>

      <div className="space-y-3">
        <SectionHeading>Allergies</SectionHeading>
        <AllergiesList patientId={subjectId} />
      </div>

      <div className="space-y-3">
        <SectionHeading>Medications</SectionHeading>
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <p className="text-sm text-charcoal-ink/70">
              Today&apos;s doses and your full medicines cabinet.
            </p>
            <Link
              href="/patient/medications"
              className="shrink-0 text-sm font-medium text-brand-green hover:underline"
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
        <LabResults patientId={subjectId} />
        <Link
          href="/patient/labs"
          className="inline-block text-sm font-medium text-brand-green hover:underline"
        >
          See all labs &amp; bookings
        </Link>
      </div>

      <div className="space-y-3">
        <SectionHeading>Care programmes</SectionHeading>
        <WeeklyPlanCard patientId={subjectId} />
      </div>

      <div className="space-y-3">
        <SectionHeading>Appointments</SectionHeading>
        <CareScheduleCard patientId={subjectId} />
        <Link
          href="/patient/appointments"
          className="inline-block text-sm font-medium text-brand-green hover:underline"
        >
          Book or manage an appointment
        </Link>
      </div>

      <div className="space-y-3">
        <SectionHeading>Referrals</SectionHeading>
        <YourReferrals patientId={subjectId} />
        <BariatricReferralStatus patientId={subjectId} />
      </div>

      <div className="space-y-3">
        <SectionHeading>Preventive tasks</SectionHeading>
        <PreventionCompletionCard patientId={subjectId} />
      </div>
    </div>
  );
}
