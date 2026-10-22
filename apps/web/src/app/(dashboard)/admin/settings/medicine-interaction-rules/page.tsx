import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { MedicineInteractionRulesPanel } from "../../../clinician/_signoff-panels/medicine-interaction-rules-panel";

export const metadata = { title: "Medicine interaction rules" };

/** Admin view of the interaction rules. An admin may draft; only the Chief Medical Officer can sign, and the database enforces that. */
export default async function MedicineInteractionRulesSettingsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Medicine interaction rules"
        description="Draft the ingredient-pair rules, each with a public source. Born empty. The Chief Medical Officer signs."
      />
      <MedicineInteractionRulesPanel />
    </div>
  );
}
