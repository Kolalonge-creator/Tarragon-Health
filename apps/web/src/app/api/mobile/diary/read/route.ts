import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { handleDiaryRead } from "@/lib/diary/handlers";

/** The phone's door to the paper diary reader (S07y, AI-021): the same handler as the web route, bearer-token auth. Stores nothing. */
export async function POST(request: Request): Promise<NextResponse> {
  const accessToken = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);
  if (authError || !user) return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });

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
