import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { SearchGapsManager } from "./search-gaps-manager";

export const metadata = { title: "Searches with no result" };

export default async function Page() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    redirect("/admin");
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title="Searches with no result"
        description="Phrases patients searched for that found nothing, with a count, so the clinical team can decide what to write next. Anonymous, and shown only once enough searches match."
        backTo={{ href: "/admin/settings/health-education", label: "Health education library" }}
      />
      <SearchGapsManager />
    </div>
  );
}
