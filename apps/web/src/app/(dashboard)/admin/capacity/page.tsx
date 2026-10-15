import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { CapacityPage } from "@/components/capacity/capacity-page";
import type { SearchParams } from "@/lib/credentialing/params";

export const metadata = { title: "Capacity and cover" };
export const dynamic = "force-dynamic";

export default async function AdminCapacity({ searchParams }: { searchParams: SearchParams }) {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  // an administrator sees the same facts and can only ASK for a pause; the database refuses anything else
  return <CapacityPage basePath="/admin/capacity" isCmo={false} searchParams={searchParams} />;
}
