import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ICON } from "@/lib/icons";
import { NotificationPreferencesForm } from "./notification-preferences-form";

/**
 * Spec §76.12/§76.13 — patient control over notification channels
 * (patient_notification_preferences, migration 20260829222502), plus a
 * short explainer of the Critical/Important/Routine priority model. Backs
 * the "Notification settings" entry lib/navigation.ts already points here.
 *
 * Scoped strictly to the ROUTINE send path: the separate, load-bearing
 * critical-notification escalation engine never reads this table and
 * cannot be opted out of from here — see notification-preferences-form.tsx.
 */
export default async function NotificationSettingsPage() {
  const { profile, subjectId } = await getPatientDashboardContext();

  // Every table on the platform is organisation-scoped; a profile with no
  // org has nothing to attach a preference row to yet.
  if (!profile.organisation_id) {
    return null;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notification settings"
        icon={NAV_ICON.bell}
        description="Choose how you'd like to hear from us for each kind of update. Critical health alerts are never covered here: they always reach you in the app."
      />
      <NotificationPreferencesForm patientId={subjectId} organisationId={profile.organisation_id} />
    </div>
  );
}
