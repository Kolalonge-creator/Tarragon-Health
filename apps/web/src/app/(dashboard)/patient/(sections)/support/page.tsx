import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { SEMANTIC_ICON } from "@/lib/icons";
import { Card, CardContent } from "@/components/ui/card";
import { CreateTicketForm } from "./create-ticket-form";
import { TicketList } from "./ticket-list";
import { ComplaintList } from "./complaint-list";
import { FileComplaintForm } from "./file-complaint-form";
import { FaqAccordion } from "./faq-accordion";

/**
 * Patient Support & Service Centre (spec §24) — the patient's clear route
 * to get help (§24.16: "a patient should always have a clear route to get
 * help"). A ticket that reads like a real emergency never becomes a ticket
 * (§24.7) — see ./actions.ts. This page never shows clinical advice itself;
 * it is a logistics/routing surface, distinct from Messages (talking with
 * your care team) and from Care & support (the clinical record).
 */
export default async function PatientSupportPage() {
  const { subjectId } = await getPatientDashboardContext();

  return (
    <DashboardSection
      id="support"
      title="Help & support"
      description="App, appointment, lab, pharmacy, or payment issue? Send it here and your care team will follow up."
      icon={SEMANTIC_ICON.clinicianFollowUp}
    >
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-6">
              <CreateTicketForm patientId={subjectId} />
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
