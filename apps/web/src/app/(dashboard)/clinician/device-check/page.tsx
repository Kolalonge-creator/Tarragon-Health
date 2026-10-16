import { redirect } from "next/navigation";
import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { DeviceCheckPage } from "@/components/capacity/device-check-page";
import type { SearchParams } from "@/lib/credentialing/params";

export const metadata = { title: "Device check" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  // the database checks every read and write too; this only keeps a non-clinician off an empty page
  if (!(await getCurrentClinicalStaff())) redirect("/clinician");
  return <DeviceCheckPage searchParams={searchParams} />;
}
