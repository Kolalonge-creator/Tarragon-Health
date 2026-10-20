import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { buildBpMonthlySummary, resolveSummaryMonth } from "@/lib/reports/bp-monthly-summary";
import { averageGateRules, minGapMinutes } from "@/lib/clinical/bp-control-rate-data";
import { BpMonthlySummaryDocument } from "@/lib/reports/bp-monthly-summary-document";

/**
 * Streams the caller's own monthly blood pressure and medicines summary as a PDF (S07x), for the patient to keep or hand to any clinic.
 * `?month=YYYY-MM-01` picks a month; without it the newest report is used. Everything is read as the caller (their stored monthly report and
 * their own completed home checks), so it can only ever hold what the patient could already see. It reads no laboratory table.
 */
export async function GET(request: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("full_name, role").eq("id", user.id).single();
  if (!profile || profile.role !== "patient") return new Response("Not found", { status: 404 });

  const monthParam = new URL(request.url).searchParams.get("month");
  const month = monthParam && /^\d{4}-\d{2}-01$/.test(monthParam) ? monthParam : null;
  if (monthParam && !month) return new Response("Invalid month", { status: 400 });

  const [reports, checks] = await Promise.all([
    supabase.rpc("my_monthly_reports", { p_limit: 12 }),
    supabase.from("home_bp_checks").select("window_end, mean_systolic, mean_diastolic, readings, days").eq("patient_id", user.id).order("window_end", { ascending: false }).limit(24),
  ]);
  if (reports.error || checks.error) return new Response("Could not load the summary", { status: 503 });

  // The month's own home readings (the patient's session: row level security keeps it to her own). A failed read leaves the line out
  // rather than printing "not enough readings" for readings we could not load.
  const resolved = resolveSummaryMonth(reports.data, month);
  let control: { readings: { systolic: number; diastolic: number; atMs: number }[]; gateRules: ReturnType<typeof averageGateRules>; minGapMinutes: number } | undefined;
  if (resolved) {
    const end = new Date(Date.parse(`${resolved}T00:00:00Z`));
    end.setUTCMonth(end.getUTCMonth() + 1);
    const vitals = await supabase
      .from("vitals_readings")
      .select("systolic, diastolic, taken_at")
      .eq("patient_id", user.id)
      .eq("vital_type", "blood_pressure")
      // The month in Lagos time: from 00:00 on the 1st (23:00 UTC the day before) up to, not including, 00:00 on the 1st of the next month.
      .gte("taken_at", new Date(Date.parse(`${resolved}T00:00:00Z`) - 3_600_000).toISOString())
      .lt("taken_at", new Date(end.getTime() - 3_600_000).toISOString())
      .order("taken_at", { ascending: true })
      .limit(1000);
    if (!vitals.error) {
      control = {
        readings: (vitals.data ?? []).flatMap((v) =>
          typeof v.systolic === "number" && typeof v.diastolic === "number" ? [{ systolic: v.systolic, diastolic: v.diastolic, atMs: Date.parse(v.taken_at) }] : [],
        ),
        gateRules: averageGateRules(),
        minGapMinutes: minGapMinutes(),
      };
    }
  }

  const summary = buildBpMonthlySummary({ patientName: profile.full_name ?? "Patient", reportRows: reports.data, month, checks: checks.data ?? [], control });
  if (!summary) return new Response("No summary for that month yet", { status: 404 });

  const buffer = await renderToBuffer(BpMonthlySummaryDocument({ summary }));
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="blood-pressure-summary-${summary.month.slice(0, 7)}.pdf"`,
    },
  });
}
