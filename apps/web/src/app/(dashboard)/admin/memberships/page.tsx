import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { MembersView } from "@/components/memberships/members-view";
import { searchParamSchema } from "@/lib/memberships/members";

export const metadata = { title: "Memberships" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminMembersPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await getCurrentProfile();
  // proxy.ts already keeps non-admins out of /admin; this is the page's own check.
  if (profile?.role !== "admin") redirect("/admin");
  const raw = (await searchParams).q;
  const search = searchParamSchema.catch("").parse(Array.isArray(raw) ? raw[0] : (raw ?? ""));
  return <MembersView base="/admin/memberships" search={search} />;
}
