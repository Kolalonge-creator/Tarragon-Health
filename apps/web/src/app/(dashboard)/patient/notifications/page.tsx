import Link from "next/link";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ICON } from "@/lib/icons";
import { NotificationCentre } from "./notification-centre";

/**
 * P19: the notification centre. The bell shows the latest few; this page keeps the whole in-app history, with category filters and
 * mark-as-read. Reached from the bell's "See all notifications" link (no new menu row; see the PR's design questions).
 */
export default async function PatientNotificationsPage() {
  // Resolves the signed-in patient (and redirects anyone else) the same way every patient page does.
  await getPatientDashboardContext();
  return (
    <div className="space-y-6">
      <PageHeader
        backTo={{ href: "/patient", label: "Dashboard" }}
        title="Notifications"
        icon={NAV_ICON.bell}
        description="Everything we have told you in the app, newest first. Open one to go to the page it is about."
      />
      <NotificationCentre />
      <p className="text-sm">
        <Link href="/patient/notification-settings" className="font-medium text-brand-green hover:underline dark:text-brand-green-bright">
          Choose how we reach you
        </Link>
      </p>
    </div>
  );
}
