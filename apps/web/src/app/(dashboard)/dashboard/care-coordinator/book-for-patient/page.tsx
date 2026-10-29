import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { BookForPatient } from "./book-for-patient";

/**
 * A Care Coordinator books on a phone call for a patient who cannot use the app. The patient is found by name or phone number and
 * only name, state, phone and Membership tier are shown. The booking itself is the same one a patient makes, so it appears on the
 * patient's dashboard and appointment list by itself.
 */
export default async function CareCoordinatorBookForPatientPage() {
  const profile = await getCurrentProfile();
  if (!profile?.organisation_id) redirect("/login");
  return <BookForPatient organisationId={profile.organisation_id} />;
}
