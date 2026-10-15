import { redirect } from "next/navigation";
import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { RestAndCoverPage } from "@/components/capacity/rest-and-cover-page";
import type { SearchParams } from "@/lib/credentialing/params";

export const metadata = { title: "Rest and cover" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!(await getCurrentClinicalStaff())) redirect("/clinician");
  return <RestAndCoverPage searchParams={searchParams} />;
}
