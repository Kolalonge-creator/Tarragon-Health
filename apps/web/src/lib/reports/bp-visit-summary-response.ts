import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { buildBpVisitSummary, parseVisitAdherence } from "@/lib/reports/bp-visit-summary";
import { BpVisitSummaryDocument } from "@/lib/reports/bp-visit-summary-document";
import { readHomeBpProgramme } from "@/lib/home-bp/read-home-bp-programme";

/** The "Bring this to your visit" PDF for the signed-in patient (S07y). Everything is read as the caller. */
export async function visitSummaryResponse(supabase: SupabaseClient<Database>, patientId: string, name: string): Promise<Response> {
  const nowMs = Date.now();
  const since = (days: number) => new Date(nowMs - days * 86_400_000).toISOString();
  const [readings, symptoms, adherence, programme] = await Promise.all([
    supabase
      .from("vitals_readings")
      .select("systolic, diastolic, taken_at, source")
      .eq("patient_id", patientId)
      .eq("vital_type", "blood_pressure")
      .is("correction_status", null)
      // the same sources the server counts for the home programme average (private.home_bp_assess_readings): never a clinic import, a photo or a wearable estimate
      .in("source", ["manual", "device"])
      .gte("taken_at", since(9))
      .order("taken_at", { ascending: false })
      .limit(500),
    supabase.from("symptom_reports").select("code, reported_at").eq("patient_id", patientId).eq("recorded_by", patientId).gte("reported_at", since(9)).order("reported_at", { ascending: false }).limit(500),
    supabase.rpc("medication_weekly_adherence", { p_patient: patientId }),
    readHomeBpProgramme(supabase),
  ]);
  // A failed read is a 503 and no document, never a summary of zeros that a clinician could take as "no readings, no symptoms".
  if (readings.error || symptoms.error || adherence.error || programme.loadFailed) return new Response("Could not load the summary", { status: 503 });
  const parsedAdherence = parseVisitAdherence(adherence.data);
  if (!parsedAdherence) return new Response("Could not load the summary", { status: 503 });
  // Only a signed programme counts: with none signed (or a live row that does not parse) no average is shown, never one from unsigned proposed values.
  const config = programme.live?.config ?? null;

  const summary = buildBpVisitSummary({
    patientName: name,
    nowMs,
    readings: readings.data ?? [],
    programme: config,
    adherence: parsedAdherence,
    symptoms: (symptoms.data ?? []).flatMap((s) => (s.code && s.reported_at ? [{ code: s.code, reported_at: s.reported_at }] : [])),
  });
  const buffer = await renderToBuffer(BpVisitSummaryDocument({ summary }));
  await supabase.rpc("log_patient_data_export", { p_scope: "bp_visit_summary" });
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="bring-to-your-visit.pdf"',
    },
  });
}
