import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { QueuePage } from "@/components/credentialing/review-pages";
import type { SearchParams } from "@/lib/credentialing/params";

export const metadata = { title: "Clinician applications" };
export const dynamic = "force-dynamic";

export default async function AdminCredentialingPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await getCurrentProfile();
  // proxy.ts already keeps non-admins out of /admin; this is the page's own check.
  if (profile?.role !== "admin") redirect("/admin");
  return <QueuePage basePath="/admin/credentialing" isCmo={false} searchParams={searchParams} />;
}
