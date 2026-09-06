import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { LoadFailure } from "@/components/ui/load-failure";
import { ContentLibraryManager, type ContentBlockRow } from "./content-library-manager";

/**
 * Clinical Director sign-off for the AI Coach's reference-content library.
 * The retrieval pipeline (find-relevant-content.ts) only ever surfaces
 * clinician_reviewed=true rows to a patient — every block here is draft
 * copy, seeded 2026-08-10, awaiting review. Approving content here is one
 * of two things needed before retrieval does anything (the other is a real
 * VOYAGE_API_KEY in the deployment environment — see voyage-embedder.ts).
 */
export default async function LpeContentLibrarySettingsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  const supabase = await createClient();
  const { data: blocks, error: blocksError } = await supabase
    .from("lpe_content_blocks")
    .select("id, key, title, body_md, condition, module, reading_level, clinician_reviewed, reviewed_at")
    .order("condition", { ascending: true, nullsFirst: false })
    .order("title", { ascending: true });

  const rows = (blocks as ContentBlockRow[] | null) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lifestyle coaching content library"
        description="Reference copy the AI Coach can draw on when replying to a patient, never quoted verbatim, used to inform an answer in the coach's own voice. A block is only ever shown to a patient (indirectly, through the coach) after a Clinical Director approves it here; edit anything that needs work first, then sign it."
      />
      {/* "No content blocks found." from a failed read reads as an empty
          library, which invites re-authoring copy that already exists and is
          already signed off. */}
      {blocksError ? (
        <LoadFailure>
          The content library could not be loaded. This is not a report that it is empty, and this
          page cannot say what has already been approved. Reload to try again.
        </LoadFailure>
      ) : (
        <ContentLibraryManager blocks={rows} />
      )}
    </div>
  );
}
