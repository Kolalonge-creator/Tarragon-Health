import { redirect, notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasAnyPermission } from "@/lib/auth/permissions";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { EmployerDetailManager } from "./employer-detail-manager";

export default async function AdminEmployerDetailPage({
  params,
}: {
  params: Promise<{ organisationId: string }>;
}) {
  const { organisationId } = await params;

  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const allowed = await hasAnyPermission("orgs.manage", "orgs.corporate.manage");
  if (!allowed) redirect("/admin");

  const svc = createServiceRoleClient();
  const [{ data: org }, { data: account }, { data: contract }, { count: rosterCount }] = await Promise.all([
    svc.from("organisations").select("id, name").eq("id", organisationId).eq("type", "corporate").maybeSingle(),
    svc.from("employer_accounts").select("*").eq("organisation_id", organisationId).maybeSingle(),
    svc
      .from("corporate_contracts")
      .select("*")
      .eq("organisation_id", organisationId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    svc
      .from("employer_roster_members")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .neq("status", "removed"),
  ]);

  if (!org) notFound();

  return (
    <EmployerDetailManager
      organisationId={organisationId}
      organisationName={org.name}
      account={account}
      contract={contract}
      rosterCount={rosterCount ?? 0}
    />
  );
}
