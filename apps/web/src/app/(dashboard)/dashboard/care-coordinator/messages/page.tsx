import { ClinicianMessagesWorklist } from "@/app/(dashboard)/clinician/messages/worklist";
import { parseInboxView } from "@/lib/worklist/care-thread-queue";

/** The same inbox doctors use, shown inside the coordinator tabs so a coordinator keeps their navigation. */
export default async function CareCoordinatorMessagesPage({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  const { view } = await searchParams;
  return <ClinicianMessagesWorklist initialView={parseInboxView(view)} />;
}
