import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { SymptomSafetyPage } from "@/components/symptom/symptom-safety-page";

export const metadata = { title: "Symptom checker safety" };
export const dynamic = "force-dynamic";

/** S60: the same safety page for the Chief Medical Officer, whose account role (`clinician`) can never open /admin. CMO only. */
export default async function ClinicianSymptomSafety({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  return <SymptomSafetyPage viewer="cmo" outcome={(await searchParams).r} />;
}
