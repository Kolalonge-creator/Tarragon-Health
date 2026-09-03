import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPermission } from "@/lib/auth/permissions";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { PageHeader } from "@/components/ui/page-header";
import { PharmaciesManager } from "./pharmacies-manager";
import type { PharmacistLoginRow } from "@/lib/queries/partner-catalogues";

export default async function PharmaciesPartnersPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!(await hasPermission("partners.pharmacies.manage"))) redirect("/admin");

  // pharmacist logins (email lives in auth.users, not profiles) — same shape
  // as the lab_partner login list on the Labs page, now that
  // admin_link_pharmacist gives an admin somewhere to actually link one.
  const svc = createServiceRoleClient();
  const { data: pharmacistProfiles } = await svc
    .from("profiles")
    .select("id, full_name, pharmacy_partner_id, is_partner_admin")
    .eq("role", "pharmacist")
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

  const pharmacistLogins: PharmacistLoginRow[] = (pharmacistProfiles ?? []).map((p) => ({
    id: p.id,
    email: emailById.get(p.id) ?? null,
    full_name: p.full_name,
    pharmacy_partner_id: p.pharmacy_partner_id,
    is_partner_admin: p.is_partner_admin,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pharmacies"
        description="Add and manage partner pharmacies, link a partner login, and designate a partner admin."
      />
      <PharmaciesManager pharmacistLogins={pharmacistLogins} />
    </div>
  );
}
