import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { ExpiryBacklog } from "@/components/learning/expiry-backlog";

export const metadata = { title: "Learning content expiry backlog" };

/** The admin view of the learning content review list. The Chief Medical Officer has the same list at /clinician/learning-review. */
export default async function Page() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    redirect("/admin");
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("learn.expiry.title")}
        description={t("learn.expiry.intro")}
        backTo={{ href: "/admin/settings/health-education", label: "Health education library" }}
      />
      <ExpiryBacklog />
    </div>
  );
}
