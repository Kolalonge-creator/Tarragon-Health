import { redirect } from "next/navigation";
import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { ClinicianRotaPage } from "@/components/rota/clinician-rota";
import type { SearchParams } from "@/lib/credentialing/params";

export const metadata = { title: "My hours and the rota" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const staff = await getCurrentClinicalStaff();
  // the database checks every read and write too; this only keeps a non-clinician off an empty page
  if (!staff) redirect("/clinician");
  return <ClinicianRotaPage searchParams={searchParams} />;
}
