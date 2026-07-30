import { NextResponse } from "next/server";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

/**
 * Device heartbeat — lets the platform know a recipient's device has been
 * seen recently at all, distinct from whether any specific notification was
 * opened. Called periodically by DeviceHeartbeat (components/shell) while a
 * dashboard tab is visible. A missed/failed beat is never surfaced to the
 * user — this is a background signal, not a feature.
 */
export async function POST(): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("touch_last_active");
  if (error) {
    return NextResponse.json({ ok: false }, { status: 200 });
  }
  return NextResponse.json({ ok: true });
}
