"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { joinConsultation, requestDialIn, type DialInOutcome, type JoinOutcome, type RoomDeps, type RpcClient } from "./room";
import { videoProvider } from "./providers";

/**
 * S21 server actions shared by the patient and clinician consultation pages. Each one checks the signed-in person first and
 * hands the work to ./room.ts, which is proved end to end against the mock providers. Results carry a short reason code and
 * never a vendor message, a link kept anywhere, a phone number or a name.
 */
const idSchema = z.string().uuid();
const mediaSchema = z.enum(["video", "audio_only"]);

type Fail = { ok: false; reason: string };

async function deps(): Promise<RoomDeps | Fail> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "signed_out" };
  const video = videoProvider();
  if (!video.ok) return { ok: false, reason: "provider" };
  const service = createServiceRoleClient();
  return {
    userId: user.id,
    userRpc: supabase as unknown as RpcClient,
    serviceRpc: service as unknown as RpcClient,
    video: video.data,
    now: () => Date.now(),
  };
}
const isFail = (d: RoomDeps | Fail): d is Fail => "ok" in d;

export async function joinConsultationAction(encounterId: string, media: "video" | "audio_only"): Promise<JoinOutcome | Fail> {
  const id = idSchema.safeParse(encounterId);
  const m = mediaSchema.safeParse(media);
  if (!id.success || !m.success) return { ok: false, reason: "not_found" };
  const d = await deps();
  return isFail(d) ? d : joinConsultation(d, id.data, m.data);
}

/** The numbers and passcode to ring into this consultation by phone. Returned to the signed-in participant only, never stored. */
export async function requestDialInAction(encounterId: string): Promise<DialInOutcome | Fail> {
  const id = idSchema.safeParse(encounterId);
  if (!id.success) return { ok: false, reason: "not_allowed" };
  const d = await deps();
  return isFail(d) ? d : requestDialIn(d, id.data);
}

/** CON-001: the patient's own answer, asked and recorded for this one consultation (INV-11). */
export async function answerScribeConsentAction(encounterId: string, granted: boolean): Promise<{ ok: boolean; granted?: boolean }> {
  const id = idSchema.safeParse(encounterId);
  if (!id.success || typeof granted !== "boolean") return { ok: false };
  const supabase = await createClient();
  const asked = await supabase.rpc("open_scribe_prompt" as never, { p_encounter: id.data } as never);
  if (asked.error) return { ok: false };
  const saved = await supabase.rpc("record_scribe_consent" as never, { p_encounter: id.data, p_granted: granted } as never);
  return saved.error ? { ok: false } : { ok: true, granted };
}

/** Either side reports that the other did not come. The database applies the wait and the credit rule; the server clock decides. */
export async function reportNoShowAction(encounterId: string): Promise<{ ok: boolean; reason?: "wait_longer" | "not_allowed" }> {
  const id = idSchema.safeParse(encounterId);
  if (!id.success) return { ok: false, reason: "not_allowed" };
  const supabase = await createClient();
  const res = await supabase.rpc("mark_encounter_no_show" as never, { p_encounter: id.data } as never);
  if (!res.error) return { ok: true };
  return { ok: false, reason: /wait a little longer/.test(res.error.message) ? "wait_longer" : "not_allowed" };
}

export async function completeConsultationAction(encounterId: string): Promise<{ ok: boolean }> {
  const id = idSchema.safeParse(encounterId);
  if (!id.success) return { ok: false };
  const supabase = await createClient();
  const res = await supabase.rpc("complete_encounter" as never, { p_encounter: id.data } as never);
  return { ok: !res.error };
}
