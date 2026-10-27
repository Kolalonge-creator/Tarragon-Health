import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { readDeviceFlags } from "@/lib/devices/flags";
import { rateLimit } from "@/lib/rate-limit";
import { AI_SYSTEMS, runGovernedAi } from "@/lib/ai-governance";
import { CUFF_VISION_MODEL_ID, isCuffVisionConfigured, readCuffDisplay } from "@/lib/vitals/cuff-display-vision";
import { normaliseCuffProposal, proposalToRecognisedLines, type CuffProposal } from "@/lib/vitals/cuff-display-proposal";

/**
 * POST /api/mobile/cuff-display-proposal (AI-022): the phone sends a photo of a blood pressure cuff display and gets back a PROPOSAL of the
 * numbers, or a request to retake the photo. It is a courtesy in front of the existing photo-reading screen, never a way to save a reading.
 *
 * STATELESS ON PURPOSE (the AI-007 pack reader's pattern, pack-actions.ts). The photo is held in memory for this one call: it is not stored,
 * not logged, not put in a queue and not attached to any row. The audit row records only that a proposal was made or refused, never the
 * numbers or the image. Nothing here writes to vitals_readings. The person looks at their photo beside editable boxes, ticks each number,
 * and only then does the existing `POST /api/mobile/photo-readings` save it as source `photo_confirmed` and triage it like a typed reading.
 *
 * Dormant twice over: the `cuff_camera_enabled` go-live guard (a test account passes it, a real person does not until it is on) and the
 * existing `device_photo_capture` module that the save route sits behind. AI-022 is registered disabled, so even with both on the kill switch
 * answers "unavailable" until a human has evaluated and enabled it. Every unavailable answer leaves the person typing the numbers.
 */
const MAX_BYTES = 6 * 1024 * 1024;
// HEIC/HEIF is not accepted by the vision API (see pack-actions.ts); the phone sends JPEG.
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
const GUARD_KEY = "cuff_camera_enabled";
// Per person, because every call is a paid vision call on a photo of a health device. A retake or two is normal; a loop is not. The short rule
// stops a burst, the daily rule stops a slow drip. Both are checked before the photo is even read from the request. PROPOSED values: the
// evaluation (OQ-CUFF-4) is what should set the final numbers. The limiter is shared across instances only when Upstash is configured;
// until then it is a per-instance window (packages/auth/src/rate-limit.ts), so these are a ceiling per instance, not a hard global cap.
const BURST_RULE = { limit: 6, windowSeconds: 10 * 60 };
const DAILY_RULE = { limit: 30, windowSeconds: 24 * 60 * 60 };

type Outcome = { ok: true; proposal: CuffProposal } | { ok: false };

export async function POST(request: Request): Promise<NextResponse> {
  const accessToken = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);
  if (authError || !user) return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });

  // INV-14, server side, fail closed: an unreadable guard is a closed guard.
  const [{ data: guardOpen, error: guardError }, flags] = await Promise.all([
    supabase.rpc("go_live_guard_is_open", { p_key: GUARD_KEY }),
    readDeviceFlags(supabase),
  ]);
  if (guardError || guardOpen !== true || !flags.device_photo_capture) {
    return NextResponse.json({ error: "Reading numbers from a photo is not switched on yet" }, { status: 404 });
  }
  if (!isCuffVisionConfigured()) return NextResponse.json({ status: "unavailable", reason: "not_configured" });

  // Keyed by the verified user id, never by anything the client sends. The phone shows its usual "type the numbers" message for this answer.
  const [burst, daily] = await Promise.all([
    rateLimit(`cuff-display:burst:${user.id}`, BURST_RULE),
    rateLimit(`cuff-display:daily:${user.id}`, DAILY_RULE),
  ]);
  if (!burst.success || !daily.success) {
    const retryAfter = Math.max(1, burst.success ? daily.retryAfterSeconds : burst.retryAfterSeconds);
    return NextResponse.json({ status: "unavailable", reason: "rate_limited" }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form body" }, { status: 400 });
  }
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Send a photo of the display." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "That photo is too large. Try one under 6MB." }, { status: 413 });
  if (!ALLOWED.includes(file.type)) return NextResponse.json({ error: "Use a JPEG, PNG or WEBP photo." }, { status: 415 });

  const imageBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");

  const governed = await runGovernedAi<Outcome>({
    supabase,
    systemCode: AI_SYSTEMS.cuffDisplayReader.code,
    inputCategory: "cuff_display_photo",
    subjectProfileId: user.id,
    run: async () => {
      const read = await readCuffDisplay({ imageBase64, mediaType: file.type });
      if (!read.ok) return { value: { ok: false as const }, modelIdentifier: CUFF_VISION_MODEL_ID, outputSummary: "model_error", resultingAction: "none", degradedReason: `vision_${read.reason}` };
      const proposal = normaliseCuffProposal(read.output);
      return {
        value: { ok: true as const, proposal },
        modelIdentifier: CUFF_VISION_MODEL_ID,
        // Never the numbers: only whether a proposal was made, or why the photo was refused.
        outputSummary: proposal.ok ? "proposal_made" : `refused:${proposal.reason}`,
        resultingAction: proposal.ok ? "cuff_proposal_for_patient_confirmation" : "retake_requested",
      };
    },
    fallback: () => ({ ok: false as const }),
  });

  if (!governed.value.ok) {
    return NextResponse.json({ status: "unavailable", reason: governed.fallbackReason === "kill_switch" ? "kill_switch" : "fallback" });
  }
  const proposal = governed.value.proposal;
  if (!proposal.ok) return NextResponse.json({ status: "retake", reason: proposal.reason });
  return NextResponse.json({
    status: "proposal",
    systolic: proposal.systolic,
    diastolic: proposal.diastolic,
    pulse: proposal.pulse,
    pulse_dropped: proposal.pulseDropped,
    lines: proposalToRecognisedLines(proposal),
  });
}
