import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { MembersView } from "@/components/memberships/members-view";
import { searchParamSchema } from "@/lib/memberships/members";

export const metadata = { title: "Memberships" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Chief Medical Officer only (canAssignCases). The CMO's account role is `clinician` and cannot open /admin, so
 * this is the same page as /admin/memberships at a path the CMO can reach. The database checks the role again.
 */
export default async function ClinicianMembersPage({ searchParams }: { searchParams: SearchParams }) {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  const raw = (await searchParams).q;
  const search = searchParamSchema.catch("").parse(Array.isArray(raw) ? raw[0] : (raw ?? ""));
  return <MembersView base="/clinician/memberships" search={search} />;
}
