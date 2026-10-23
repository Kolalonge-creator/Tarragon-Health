"use server";

import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveSubjectId } from "@/lib/acting/acting-for";
import { handleDiarySave, type DiarySaveResponse } from "@/lib/diary/handlers";

export type SaveDiaryActionResult = DiarySaveResponse | { status: "failed" };

/**
 * Saves the rows the person confirmed from their paper diary (S07y). Online only. The rows are re-validated on the server with the same pure rules the
 * screen used, go through the ordinary reading insert (so every red-flag trigger fires), and the same post-insert safety assessments run as for a typed reading.
 * A thrown network error is caught here and answered as "failed", so the route segment (and the rows the person typed) stays mounted.
 */
export async function saveDiaryAction(rows: unknown): Promise<SaveDiaryActionResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { status: "failed" };
    // Whose readings these are: the person whose account is open (a supporter with a live manage grant), re-checked on the server every time.
    const subjectId = await resolveSubjectId(user.id);
    const { body } = await handleDiarySave(supabase, { userId: user.id, subjectId, route: "patient/diary/actions" }, { rows });
    if (body.status === "done") {
      revalidatePath("/patient/vitals");
      revalidatePath("/patient");
    }
    return body;
  } catch (err) {
    Sentry.captureException(err, { extra: { action: "saveDiaryAction" } });
    return { status: "failed" };
  }
}
