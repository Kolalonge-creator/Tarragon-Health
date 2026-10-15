import { NextResponse } from "next/server";
import { z } from "zod";
import { createBearerClient } from "@/lib/supabase/bearer";
import { readDeviceFlags } from "@/lib/devices/flags";

/**
 * A personal ECG device's own rhythm result (S70a, 18.6, decision S70-3).
 *
 * The route stores the device's label VERBATIM and nothing else about the tracing: no vendor API, no tracing, no interpretation. Two
 * sources reach it: the phone's own health data (an iPhone's ECG classification, read on the phone) and a label the person copies from
 * the report their device made (alongside the existing ECG report upload). The database decides what follows: a result that is not
 * clearly normal creates ONE routine clinician task due within a working day and one neutral notice; the patient is shown a fixed
 * sentence and never a diagnosis. Chest pain, fainting or breathlessness answered "yes now" goes through the existing symptom red path.
 *
 * DORMANT behind the `device_ecg_rhythm_alerts` module: 404 until an admin switches it on.
 */
const bodySchema = z.object({
  source: z.enum(["healthkit_ecg", "ecg_report", "device_label"]),
  device_label: z.string().trim().min(1).max(200),
  device_name: z.string().trim().max(120).optional(),
  recorded_at: z.string().datetime(),
  external_id: z.string().trim().min(1).max(200),
  symptoms: z.array(z.enum(["chest_pain", "fainting", "breathlessness"])).max(3).optional(),
  patient_id: z.string().uuid().optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const accessToken = authHeader?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);
  if (authError || !user) return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });

  const flags = await readDeviceFlags(supabase);
  if (!flags.device_ecg_rhythm_alerts) return NextResponse.json({ error: "Device rhythm results are not switched on yet" }, { status: 404 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  const b = parsed.data;

  const { data, error } = await supabase.rpc("record_device_rhythm_result", {
    p_source: b.source,
    p_device_label: b.device_label,
    p_recorded_at: b.recorded_at,
    p_external_id: b.external_id,
    p_device_name: b.device_name,
    p_symptoms: b.symptoms ?? [],
    p_patient_id: b.patient_id,
  });
  if (error) {
    if (error.code === "42501") return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (error.code === "22023") return NextResponse.json({ error: error.message }, { status: 422 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const result = (data ?? {}) as { category?: string; patient_copy?: string | null; red_path?: boolean; duplicate?: boolean };
  // The phone shows ONLY `patient_copy` (a fixed sentence), and the existing emergency guidance when `red_path` is true. It never shows `category`.
  return NextResponse.json({
    success: true,
    duplicate: result.duplicate === true,
    patient_copy: result.patient_copy ?? null,
    red_path: result.red_path === true,
  });
}
