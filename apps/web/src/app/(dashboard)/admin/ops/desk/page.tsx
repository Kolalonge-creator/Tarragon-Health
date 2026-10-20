import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { OpsDeskPage } from "@/components/ops-desk/ops-desk-page";
import type { SearchParams } from "@/lib/credentialing/params";

export const metadata = { title: "Ops desk" };
export const dynamic = "force-dynamic";

export default async function AdminOpsDesk({ searchParams }: { searchParams: SearchParams }) {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  return <OpsDeskPage mode="admin" searchParams={searchParams} />;
}
