import { CareOperationsPage } from "@/components/care-operations/care-operations-page";

export const metadata = { title: "Care operations" };
export const dynamic = "force-dynamic";

/** MSG-5: the coordinator's view of the same summary doctors see. Message tiles link to the coordinator's own inbox tab; the doctor
 * queues (alerts, results, monthly check-ins) are shown as counts only, because a coordinator cannot open them. */
export default function CareCoordinatorOperations() {
  return <CareOperationsPage messagesHref="/dashboard/care-coordinator/messages" showDoctorLinks={false} />;
}
