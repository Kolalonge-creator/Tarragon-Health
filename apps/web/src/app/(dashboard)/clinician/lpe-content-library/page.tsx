import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { LoadFailure } from "@/components/ui/load-failure";
import {
  ContentLibraryManager,
  type ContentBlockRow,
} from "@/app/(dashboard)/admin/settings/lpe-content-library/content-library-manager";

export const metadata = { title: "Lifestyle coaching content library" };

/**
 * The Chief Medical Officer's own reachable path to the AI Coach's reference
 * content. `admin/settings/lpe-content-library/page.tsx` redirects anyone whose
 * `profiles.role !== "admin"`, and a real CMO account is always `clinician`
 * (CLAUDE.md, "never re-split the account role"), so until this page existed
 * the only person who could sign a content block had no page to do it from.
 * Same manager, same sign RPC (`sign_lpe_content_block`, the real gate).
 */
export default async function ClinicianLpeContentLibraryPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) {
    redirect("/clinician");
  }

  const supabase = await createClient();
  const { data: blocks, error } = await supabase
    .from("lpe_content_blocks")
    .select("id, key, title, body_md, condition, module, reading_level, clinician_reviewed, reviewed_at")
    .order("condition", { ascending: true, nullsFirst: false })
    .order("title", { ascending: true });

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Lifestyle coaching content library"
        description="Reference copy the AI Coach can draw on when replying to a patient. A block only ever reaches a patient, indirectly through the coach, after you approve it here."
      />
      {error ? (
        <LoadFailure>
          The content library could not be loaded. This is not a report that it is empty. Reload to try again.
        </LoadFailure>
      ) : (
        <ContentLibraryManager blocks={(blocks as ContentBlockRow[] | null) ?? []} />
      )}
    </div>
  );
}
