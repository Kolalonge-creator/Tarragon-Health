import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { SEMANTIC_ICON } from "@/lib/icons";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Disclosure } from "@/components/ui/disclosure";
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
      description="Answers first. If you still need help, message your care team or report a problem with the app."
      icon={SEMANTIC_ICON.clinicianFollowUp}
    >
      <div className="space-y-4">
        <Link
          href="/patient/messages"
          className="flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-brand-green/30 bg-brand-green/5 px-4 py-3 text-sm font-semibold text-charcoal-ink hover:bg-brand-green/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green dark:text-night-ink"
        >
          <span>
            Message your care team
            <span className="block text-xs font-normal text-charcoal-ink/60 dark:text-night-ink/60">
              For anything about your health, appointments, medicines or results.
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
        </Link>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-charcoal-ink">Common questions</h3>
          <FaqAccordion />
        </div>

        <Disclosure
          title="Report a problem with the app"
          hint="Something is broken or not working as it should."
          defaultOpen={Boolean(prefill)}
        >
          <CreateTicketForm patientId={subjectId} {...(prefill ? { prefill } : {})} />
          <div>
            <h3 className="mb-2 text-sm font-semibold text-charcoal-ink">Your tickets</h3>
            <TicketList patientId={subjectId} />
          </div>
        </Disclosure>

        <Disclosure title="Complaints" hint="Not happy with how something was handled.">
          <ComplaintList patientId={subjectId} />
          <FileComplaintForm patientId={subjectId} />
        </Disclosure>

        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
          For help with appointments, pharmacy, laboratory, insurance, referrals or payments, use the Need help card on your Care page.
        </p>
      </div>
    </DashboardSection>
  );
}
