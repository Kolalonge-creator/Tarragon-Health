"use server";

import { createClient } from "@/lib/supabase/server";

/** Records that a session was finished. Best effort: a failure here never interrupts the session. Returns whether it was saved. */
export async function recordMediaSessionAction(mediaId: string, listenedSeconds: number): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(mediaId) || !Number.isFinite(listenedSeconds)) return false;
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_media_session", { p_media: mediaId, p_listened_seconds: Math.max(0, Math.min(14400, Math.round(listenedSeconds))) });
  return !error;
}
