import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleDiaryRead } from "@/lib/diary/handlers";

/**
 * A photo of the person's own paper diary page to SUGGESTED rows (S07y, AI-021). Cookie-session auth. Nothing is stored: not the photo, not a value.
 * Closed (answers "not_open") unless the paper_diary_ai_reader guard is open for the person, and the model is reached only through runGovernedAi.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }
  const file = formData.get("file");
  const { httpStatus, body } = await handleDiaryRead(supabase, user.id, file instanceof File ? file : null);
  return NextResponse.json(body, { status: httpStatus, headers: { "Cache-Control": "private, no-store" } });
}
