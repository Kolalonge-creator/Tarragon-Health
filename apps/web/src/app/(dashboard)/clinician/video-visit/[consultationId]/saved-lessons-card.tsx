import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Lessons the patient saved with "Ask your care team about this" (S55, spec 9.4). Read through consultation_saved_lessons(),
 * which needs a tie to the patient (INV-12) and writes an audit row on every read (INV-10); a clinician with no tie sees
 * nothing. Shown only when there is something to show, so a visit with no saved lessons is unchanged.
 */
export async function SavedLessonsCard({ patientId, consultationId }: { patientId: string; consultationId: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("consultation_saved_lessons", { p_patient: patientId });
  if (error) {
    // Not silent: an empty card and a failed read look the same to the clinician, and the patient asked for this to be raised.
    return (
      <Card>
        <CardContent className="pt-4 text-sm text-charcoal-ink/70">
          We could not load the lessons this patient saved to talk about. Please refresh the page; if it keeps failing, ask the patient directly.
        </CardContent>
      </Card>
    );
  }
  if (!data || data.length === 0) return null;
  const waiting = data.filter((l) => !l.discussed_at);

  async function markDiscussed() {
    "use server";
    const s = await createClient();
    await s.rpc("mark_saved_lessons_discussed", { p_patient: patientId });
    revalidatePath(`/clinician/video-visit/${consultationId}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Lessons the patient saved to talk about</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <ul className="list-disc space-y-1 pl-5">
          {data.map((l) => (
            <li key={l.code}>
              {l.title}
              {l.discussed_at ? <span className="text-charcoal-ink/50"> (discussed)</span> : null}
            </li>
          ))}
        </ul>
        {waiting.length > 0 && (
          <form action={markDiscussed}>
            <Button type="submit" size="sm" variant="outline">
              Mark as discussed
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
