import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { SEMANTIC_ICON } from "@/lib/icons";
import { Card, CardContent } from "@/components/ui/card";
import { CreateTicketForm } from "./create-ticket-form";
import { TicketList } from "./ticket-list";
import { ComplaintList } from "./complaint-list";
import { FileComplaintForm } from "./file-complaint-form";
import { FaqAccordion } from "./faq-accordion";
import { t } from "@tarragon/i18n";

/**
 * Patient Support & Service Centre (spec §24), narrowed to technical
 * support + formal complaints — see the support_tickets_category_technical_only
 * migration for why: appointment/pharmacy/laboratory/insurance/referral/
 * payment help already has a live surface, the "Need help" card on the
 * Care page (navigation_requests, module 75). A ticket that reads like a
 * real emergency never becomes a ticket (§24.7) — see ./actions.ts. This
 * page never shows clinical advice itself; it is a logistics/routing
 * surface, distinct from Messages (talking with your care team) and from
 * Care & support (the clinical record).
 */
export default async function PatientSupportPage({ searchParams }: { searchParams: Promise<{ topic?: string | string[] }> }) {
  const { subjectId } = await getPatientDashboardContext();
  // S58b: the points screen links here with ?topic=points so a credit that has not appeared can be raised in two taps. Only this one known
  // topic pre-fills the form; any other value is ignored, and nothing from the address is ever put into the ticket text.
  const { topic } = await searchParams;
  const prefill =
    topic === "points"
      ? { subject: t("points.pending.ask_prefill_subject"), description: t("points.pending.ask_prefill_body") }
      : undefined;

  return (
    <DashboardSection
      id="support"
      title="Help & support"
      description="Use this page to report a problem with the app. For help with appointments, pharmacy, laboratory, insurance, referrals or payments, use the 'Need help' card on your Care page."
      icon={SEMANTIC_ICON.clinicianFollowUp}
    >
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-6">
              <CreateTicketForm patientId={subjectId} {...(prefill ? { prefill } : {})} />
            </CardContent>
          </Card>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-charcoal-ink">Your tickets</h3>
            <TicketList patientId={subjectId} />
          </div>

          <ComplaintList patientId={subjectId} />
          <FileComplaintForm patientId={subjectId} />
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-charcoal-ink">Frequently asked questions</h3>
          <FaqAccordion />
        </div>
      </div>
    </DashboardSection>
  );
}
