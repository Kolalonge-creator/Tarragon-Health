import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { ExpiryPage } from "@/components/credentialing/review-pages";
import type { SearchParams } from "@/lib/credentialing/params";

export const metadata = { title: "Licences and cover" };
export const dynamic = "force-dynamic";

export default async function AdminCredentialingExpiry({ searchParams }: { searchParams: SearchParams }) {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  return <ExpiryPage basePath="/admin/credentialing" isCmo={false} searchParams={searchParams} />;
}
