import { CareOperationsPage } from "@/components/care-operations/care-operations-page";

export const metadata = { title: "Care operations" };
export const dynamic = "force-dynamic";

/** MSG-5: the coordinator's view of the same summary doctors see. Message tiles link to the coordinator's own inbox tab; alert tiles
 * link to the read-only operations queue (on the coordinator allow-list since 2026-09-05); results and monthly check-ins are shown as
 * counts only, because a coordinator cannot open those doctor pages. */
export default function CareCoordinatorOperations() {
  return (
    <CareOperationsPage
      messagesHref="/dashboard/care-coordinator/messages"
      alertsHref="/clinician/operations-queue"
      showDoctorLinks={false}
    />
  );
}
