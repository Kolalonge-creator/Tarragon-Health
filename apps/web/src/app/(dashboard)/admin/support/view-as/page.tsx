import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { canStartSupportViewAs } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { SupportViewAsConsole } from "./support-view-as-console";

export const metadata = { title: "Support view-as" };

export default async function SupportViewAsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  // proxy.ts already admits admin (freely) and any delegated support.view_as grantee
  // (via custom_role_id / user_permission_grants) into /admin/**; this is the page-level
  // capability check on top of that — the real authority is the DB's enforce-rules
  // trigger (private.has_permission('support.view_as')), this only avoids showing the
  // tool to someone it would refuse.
  const allowed = await canStartSupportViewAs();
  if (!allowed) redirect("/admin");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Support view-as"
        description="Enter a time-boxed (30 minutes), read-only, audited shadow view of a specific patient's or clinician's account summary to debug a reported issue. The patient/clinician is notified in-app the moment a session starts, naming you and your reason. Nothing here can be edited — this tool has no write actions at all."
      />
      <SupportViewAsConsole />
    </div>
  );
}
