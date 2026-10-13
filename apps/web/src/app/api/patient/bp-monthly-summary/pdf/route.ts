import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { buildBpMonthlySummary } from "@/lib/reports/bp-monthly-summary";
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

  const summary = buildBpMonthlySummary({ patientName: profile.full_name ?? "Patient", reportRows: reports.data, month, checks: checks.data ?? [] });
  if (!summary) return new Response("No summary for that month yet", { status: 404 });

  const buffer = await renderToBuffer(BpMonthlySummaryDocument({ summary }));
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="blood-pressure-summary-${summary.month.slice(0, 7)}.pdf"`,
    },
  });
}
