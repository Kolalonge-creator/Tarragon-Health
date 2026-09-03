import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPermission } from "@/lib/auth/permissions";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { PageHeader } from "@/components/ui/page-header";
import { LabsManager } from "./labs-manager";
import type { LabPartnerLoginRow } from "@/lib/queries/partner-catalogues";

export default async function LabsPartnersPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!(await hasPermission("partners.labs.manage"))) redirect("/admin");

  // lab_partner logins (email lives in auth.users, not profiles) so the admin
  // can link an already-provisioned login (via /admin/settings/members) to a
  // specific lab_providers row — the piece that was previously "set
  // lab_provider_id via direct SQL, no admin UI yet".
  const svc = createServiceRoleClient();
  const { data: labPartnerProfiles } = await svc
    .from("profiles")
    .select("id, full_name, lab_provider_id, is_partner_admin")
    .eq("role", "lab_partner")
    .order("created_at", { ascending: false });

  const emailById = new Map<string, string | null>();
  let page = 1;
  for (;;) {
    const { data: usersPage } = await svc.auth.admin.listUsers({ page, perPage: 200 });
    const list = usersPage?.users ?? [];
    list.forEach((u) => emailById.set(u.id, u.email ?? null));
    if (list.length < 200) break;
    page += 1;
    if (page > 25) break;
  }

  const labPartnerLogins: LabPartnerLoginRow[] = (labPartnerProfiles ?? []).map((p) => ({
    id: p.id,
    email: emailById.get(p.id) ?? null,
    full_name: p.full_name,
    lab_provider_id: p.lab_provider_id,
    is_partner_admin: p.is_partner_admin,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Labs"
        description="Add and manage the lab providers patients can book with, keep contact details current, link a partner login, and track turnaround performance."
      />
      <LabsManager labPartnerLogins={labPartnerLogins} />
    </div>
  );
}
