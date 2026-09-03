import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { LeadsManager } from "./leads-manager";

export type LeadRow = {
  id: string;
  name: string;
  contact: string;
  role: string;
  message: string | null;
  source: string;
  created_at: string;
  contacted_at: string | null;
  contacted_by_name: string | null;
};

export default async function AdminLeadsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  // The super admin or a member delegated `leads.manage` may triage leads.
  // Content-level guard on top of the RLS the reads/writes obey.
  if (!(await hasPermission("leads.manage"))) {
    redirect("/admin");
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("leads")
    .select("id, name, contact, role, message, source, created_at, contacted_at, contacted_by:profiles!leads_contacted_by_fkey(full_name)")
    .order("created_at", { ascending: false });

  const leads: LeadRow[] = (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    contact: row.contact,
    role: row.role,
    message: row.message,
    source: row.source,
    created_at: row.created_at,
    contacted_at: row.contacted_at,
    contacted_by_name: (row.contacted_by as { full_name: string | null } | null)?.full_name ?? null,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads"
        description="Everyone who has submitted the marketing site's contact form or plan-finder, including employer and HMO enquiries. Mark one as contacted once you have followed up."
      />
      <LeadsManager leads={leads} />
    </div>
  );
}
