import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { TaskTypesPage } from "@/components/queue/task-types-page";

export const metadata = { title: "Task types and priorities" };
export const dynamic = "force-dynamic";

export default async function ClinicianTaskTypes() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  return <TaskTypesPage />;
}
