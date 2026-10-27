import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { recordTimeEntry } from "@/lib/clinician/time-record";
import { timeEntryInputSchema } from "@/lib/clinician/time-capture";

/**
 * W-01: the page-unload send. navigator.sendBeacon posts the last seconds here when the tab is hidden or closed, because a server action
 * cannot be relied on during unload. Same validation and same RPC as the server action; the database still decides whether the work is the
 * caller's. Always answers quickly and never with detail: time capture must not get in the way of the work.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const parsed = timeEntryInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const result = await recordTimeEntry(supabase, parsed.data);
  return NextResponse.json({ ok: result.ok }, { status: result.ok ? 200 : 403 });
}
