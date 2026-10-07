import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { DetailPage } from "@/components/credentialing/review-pages";
import type { SearchParams } from "@/lib/credentialing/params";

export const metadata = { title: "Review application" };
export const dynamic = "force-dynamic";

export default async function AdminCredentialingDetail({
  params,
  searchParams,
}: {
  params: Promise<{ applicationId: string }>;
  searchParams: SearchParams;
}) {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  const { applicationId } = await params;
  if (!z.uuid().safeParse(applicationId).success) notFound();
  return <DetailPage basePath="/admin/credentialing" isCmo={false} applicationId={applicationId} searchParams={searchParams} />;
}
