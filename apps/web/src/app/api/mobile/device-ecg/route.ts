import { NextResponse } from "next/server";
import { z } from "zod";
import { createBearerClient } from "@/lib/supabase/bearer";

/**
 * S70 (18.6): a personal ECG device's own result, reported by the phone.
 *
 * Tarragon shows and stores only what the device itself called the recording; it has no rhythm algorithm of its own and the
 * tracing is never read here. An irregular or inconclusive result becomes a routine clinician task (CMO pack C3) inside
 * `report_device_ecg_result`, behind the `device_alerts_enabled` go-live guard; a normal or unclassified result stores nothing.
 * The reply says only that the care team will look. It never carries a rhythm name back to the patient, and chest pain, fainting
 * or breathlessness are handled by the existing symptom check and emergency guidance on the phone, not here (INV-01, INV-06).
 */
const bodySchema = z.object({
  classification: z.enum(["sinus_rhythm", "irregular_rhythm", "inconclusive", "not_classified"]),
  provider: z.string().trim().min(1).max(40),
  device_result_text: z.string().trim().max(120).optional(),
  recorded_at: z.string().refine((v) => !Number.isNaN(Date.parse(v)), { message: "Enter a valid time" }),
});

export async function POST(request: Request): Promise<NextResponse> {
  const accessToken = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);
  if (authError || !user) return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("report_device_ecg_result", {
    p_classification: parsed.data.classification,
    p_provider: parsed.data.provider,
    p_device_result_text: parsed.data.device_result_text ?? "",
    p_recorded_at: new Date(parsed.data.recorded_at).toISOString(),
  });
  if (error) {
    // 22023 is the database refusing a value it will never accept (out of range time, unknown classification): a refusal, not an outage.
    return NextResponse.json({ error: error.message }, { status: error.code === "22023" ? 400 : 500 });
  }
  const result = (data ?? {}) as { alert?: boolean; capped?: boolean };
  return NextResponse.json({ success: true, review: result.alert === true, capped: result.capped === true });
}
