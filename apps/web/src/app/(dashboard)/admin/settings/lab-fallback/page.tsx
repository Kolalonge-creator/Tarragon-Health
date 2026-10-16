import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { readLabFallback } from "@/lib/lab-results/read-lab-fallback";
import { PageHeader } from "@/components/ui/page-header";
import { LabFallbackView } from "@/app/(dashboard)/clinician/lab-fallback/lab-fallback-view";

/** Read only for admin: signing is the Chief Medical Officer's alone (see /clinician/lab-fallback). */
export default async function AdminLabFallbackPage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") redirect("/");
  const { signoff, loadFailed } = await readLabFallback(await createClient());
  return (
    <div className="space-y-6">
      <PageHeader title="Lab result fallback message" description="Read only. The Chief Medical Officer signs this." />
      {loadFailed ? <p role="alert" className="text-sm text-red-700">The fallback wording could not be loaded.</p> : <LabFallbackView signoff={signoff} canSign={false} />}
    </div>
  );
}
