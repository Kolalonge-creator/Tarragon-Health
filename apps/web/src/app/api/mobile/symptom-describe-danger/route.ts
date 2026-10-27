import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { recordDescribeDanger } from "@/lib/symptom-checkback/describe-danger";

/**
 * S59c (OQ-S59c-05): the phone found danger wording in its describe box and shows the guidance on the device first. This route is told the
 * FACT only: `{ session, category }`. The typed words never leave the phone. It REUSES the web's `recordDescribeDanger`. It never fails the
 * phone: any problem answers `{ recorded: false }`, and the phone then makes no promise about the care team.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const accessToken = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(accessToken);
  if (error || !user) return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ recorded: false, doctorAlerted: false }, { status: 400 });
  }
  return NextResponse.json(await recordDescribeDanger(supabase, user.id, body));
}
