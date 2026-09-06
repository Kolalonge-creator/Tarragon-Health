import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ICON } from "@/lib/icons";
import { MessagesFlow } from "../messages-flow";

export default async function MessagesPage() {
  // Resolved the same way as every other /patient/* section (and the way
  // your-care-team.tsx links here) so a supporter acting for someone sees
  // and sends THAT person's messages, not their own — see the acting-for bug
  // fixed alongside this route in the 2026-09-01 patient dashboard audit.
  const { subjectId } = await getPatientDashboardContext();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Messages"
        icon={NAV_ICON.messages}
        backTo={{ href: "/patient", label: "Dashboard" }}
        description="Message your care team in the app and they'll reply here. For anything urgent, use the emergency options on your dashboard rather than a message."
      />
      <MessagesFlow patientId={subjectId} />
    </div>
  );
}
