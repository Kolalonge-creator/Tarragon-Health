import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { LoadFailure } from "@/components/ui/load-failure";
import { MediaLibraryManager, type MediaRow } from "./media-library-manager";

export const metadata = { title: "Calm and sleep library" };

/**
 * Where the meditation, sleep and breathing library is managed (S57). A new item is a draft placeholder and cannot be published until it
 * has a named reviewer, a review date, a future next review date and its audio or script (the database enforces it and the message
 * comes back here). An item past its next review date stops being served at once. Nothing on this page signs anything clinical.
 */
export default async function MediaLibrarySettingsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  const supabase = await createClient();
  const [items, report] = await Promise.all([
    supabase
      .from("media_library")
      .select("id, code, kind, exercise_type, title, summary, series, series_position, language, voice, duration_seconds, bytes, audio_url, content_status, is_placeholder, is_active, reviewed_by_name, reviewed_at, next_review_due, script, faith_leader_reviewer_name, faith_leader_reviewer_role, faith_leader_reviewed_at")
      .order("series")
      .order("series_position"),
    supabase.rpc("media_library_readiness_report"),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="Calm and sleep library" description="Meditations, sleep stories, soundscapes, breathing and exercises. Nothing reaches a patient until it is reviewed and in date." />
      {items.error ? (
        <LoadFailure>The library could not be loaded. Do not publish anything from here until it loads.</LoadFailure>
      ) : (
        <MediaLibraryManager rows={(items.data ?? []) as MediaRow[]} report={(report.data ?? null) as { servable: number; placeholders: number; draft: number; expired: number } | null} />
      )}
    </div>
  );
}
