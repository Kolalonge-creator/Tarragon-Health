import { redirect } from "next/navigation";
import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { ClinicianEarningsView } from "@/components/earnings/clinician-earnings-view";

export const metadata = { title: "Earnings" };
export const dynamic = "force-dynamic";

export default async function ClinicianEarningsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  // the database decides who is contracted; this only keeps a non-clinician off the page
  if (!(await getCurrentClinicalStaff())) redirect("/clinician");
  return <ClinicianEarningsView />;
}
