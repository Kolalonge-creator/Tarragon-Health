import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { FireDrillsPage } from "@/components/capacity/fire-drills-page";

export const metadata = { title: "Fire drills" };
export const dynamic = "force-dynamic";

export default async function ClinicianFireDrills() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  return <FireDrillsPage />;
}
