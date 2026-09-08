import { NextResponse } from "next/server";
import { z } from "zod";
import { createBearerClient } from "@/lib/supabase/bearer";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { SEXUAL_HEALTH_INSTRUMENTS, type SexualHealthInstrument } from "@/lib/validation/sexual-health-screen";
import { scoreSexualHealthScreen, SEXUAL_HEALTH_ITEM_COUNT } from "@/lib/rules/sexual-health-scoring";
import type { Json } from "@tarragon/shared";

/**
 * Mobile equivalent of apps/web/.../patient/sexual-health/sexual-wellness-actions.ts's
 * submitSexualHealthScreen. Scored here — never trusting a client-supplied
 * total/band — and written via the service role: sexual_health_screens has
 * no client-facing INSERT policy at all (same discipline as
 * mental_health_screens).
 */
const bodySchema = z.object({
  instrument: z.enum(SEXUAL_HEALTH_INSTRUMENTS),
  items: z.array(z.coerce.number().int()).length(SEXUAL_HEALTH_ITEM_COUNT),
});

const ITEM_RANGE: Record<SexualHealthInstrument, { min: number; max: number }> = {
  iief5: { min: 1, max: 5 },
  libido_brief: { min: 1, max: 5 },
  fsfi_pain: { min: 0, max: 5 },
  pe_diagnostic_tool: { min: 0, max: 5 },
};

export async function POST(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const accessToken = authHeader?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }

  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);
  if (authError || !user) {
    return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Please answer every question" }, { status: 400 });
  }
  const { instrument, items } = parsed.data;
  const range = ITEM_RANGE[instrument];
  if (items.some((v) => v < range.min || v > range.max)) {
    return NextResponse.json({ error: "Please answer every question" }, { status: 400 });
  }

  const { data: profile } = await supabase.from("profiles").select("organisation_id").eq("id", user.id).single();
  if (!profile?.organisation_id) {
    return NextResponse.json({ error: "No organisation on file" }, { status: 400 });
  }

  const { totalScore, severityBand, cardiometabolicFlag } = scoreSexualHealthScreen(instrument, items);

  const service = createServiceRoleClient();
  const { error: insertError } = await service.from("sexual_health_screens").insert({
    organisation_id: profile.organisation_id,
    patient_id: user.id,
    instrument,
    total_score: totalScore,
    severity_band: severityBand,
    cardiometabolic_flag: cardiometabolicFlag,
    item_responses: { items } as Json,
  });
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 400 });
  }

  return NextResponse.json({ success: true, instrument, totalScore, severityBand, cardiometabolicFlag });
}
