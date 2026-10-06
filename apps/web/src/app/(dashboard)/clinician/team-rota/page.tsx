import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { RotaBuilderPage } from "@/components/rota/rota-builder";
import type { SearchParams } from "@/lib/credentialing/params";

export const metadata = { title: "Rota and lead clinicians" };
export const dynamic = "force-dynamic";

/** The Chief Medical Officer's own entry to the rota builder: their account role is `clinician`, so /admin is closed to them. */
export default async function TeamRotaPage({ searchParams }: { searchParams: SearchParams }) {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  return <RotaBuilderPage returnTo="/clinician/team-rota" searchParams={searchParams} />;
}
