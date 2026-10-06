import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { RotaBuilderPage } from "@/components/rota/rota-builder";
import type { SearchParams } from "@/lib/credentialing/params";

export const metadata = { title: "Rota and lead clinicians" };
export const dynamic = "force-dynamic";

export default async function AdminRotaPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await getCurrentProfile();
  // proxy.ts already keeps non-admins out of /admin; this is the page's own check.
  if (profile?.role !== "admin") redirect("/admin");
  return <RotaBuilderPage returnTo="/admin/rota" searchParams={searchParams} />;
}
