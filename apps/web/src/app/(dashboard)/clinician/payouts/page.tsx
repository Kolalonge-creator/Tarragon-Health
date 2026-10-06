import { redirect } from "next/navigation";
import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { ClinicianPayoutsView } from "@/components/payouts/clinician-payouts-view";

export const metadata = { title: "Payouts" };
export const dynamic = "force-dynamic";

export default async function ClinicianPayoutsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!(await getCurrentClinicalStaff())) redirect("/clinician");
  return <ClinicianPayoutsView />;
}
