import { ClinicianMessagesWorklist } from "@/app/(dashboard)/clinician/messages/worklist";
import { parseInboxView, parseUnansweredOnly } from "@/lib/worklist/care-thread-queue";

/** The same inbox doctors use, shown inside the coordinator tabs so a coordinator keeps their navigation. */
export default async function CareCoordinatorMessagesPage({ searchParams }: { searchParams: Promise<{ view?: string | string[]; unanswered?: string | string[] }> }) {
  const { view, unanswered } = await searchParams;
  return <ClinicianMessagesWorklist initialView={parseInboxView(view)} initialUnansweredOnly={parseUnansweredOnly(unanswered)} />;
}
