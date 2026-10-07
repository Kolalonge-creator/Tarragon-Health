import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { AliasManager } from "@/components/learning/alias-manager";

export const metadata = { title: "Learning search terms" };

export default async function LearningAliasesPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  return (
    <div className="space-y-6">
      <PageHeader
        title="Learning search terms"
        description="Draft everyday words for library search. Only the Chief Medical Officer can mark a term reviewed (from the clinician learning page); search ignores a term until then."
        backTo={{ href: "/admin/settings/health-education", label: "Health education library" }}
      />
      <AliasManager canReview={false} />
    </div>
  );
}
