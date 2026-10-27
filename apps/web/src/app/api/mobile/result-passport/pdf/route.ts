import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createBearerClient } from "@/lib/supabase/bearer";
import { requestSchema, summaryConfig, SECTION_KEYS } from "@/lib/doctor-summary-pdf/model";
import { loadDoctorSummary, recordSummaryGeneration } from "@/lib/doctor-summary-pdf/load";
import { DoctorSummaryPdfDocument } from "@/lib/doctor-summary-pdf/document";
import { isPassportOpen } from "@/lib/doctor-summary-pdf/passport-guard";

/**
 * POST /api/mobile/result-passport/pdf: the phone's way to build the result passport PDF and keep a copy on the phone for the clinic
 * visit where there is no signal. Same builder, same audit row, same section rules as the web form (`/api/patient/doctor-summary/pdf`),
 * but bearer-authenticated and JSON-bodied. Always the signed-in person's OWN record: there is no patient id in the request.
 *
 * Dormant behind `result_passport_enabled`: 404 until it is on (a test account passes it). The same order as the web route: validate,
 * guard, audit row, read, render. A failure at any step is an error with no document, never a PDF that quietly lacks a section.
 */
export async function POST(request: Request): Promise<Response> {
  const accessToken = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);
  if (authError || !user) return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });

  if (!(await isPassportOpen(supabase))) return NextResponse.json({ error: "The result passport is not switched on yet" }, { status: 404 });

  const { data: profile } = await supabase.from("profiles").select("organisation_id, role").eq("id", user.id).maybeSingle();
  if (!profile?.organisation_id || profile.role !== "patient") return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: { days?: unknown; sections?: unknown };
  try {
    body = (await request.json()) as { days?: unknown; sections?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const cfg = summaryConfig();
  const parsed = requestSchema(cfg).safeParse({
    days: body.days == null ? null : String(body.days),
    sections: Array.isArray(body.sections) ? body.sections.map(String).filter((s) => (SECTION_KEYS as readonly string[]).includes(s)) : [],
  });
  if (!parsed.success) return NextResponse.json({ error: "Choose at least one section and a period." }, { status: 400 });

  const audited = await recordSummaryGeneration(supabase, { id: user.id, organisationId: profile.organisation_id }, parsed.data);
  if (!audited.ok) return NextResponse.json({ error: "The passport could not be built just now. Please try again." }, { status: 503 });
  const result = await loadDoctorSummary(supabase, user.id, parsed.data, Date.now(), cfg);
  if (!result.ok) return NextResponse.json({ error: "The passport could not be built just now. Please try again." }, { status: 503 });

  let buffer: Buffer;
  try {
    buffer = await renderToBuffer(DoctorSummaryPdfDocument({ data: result.data }));
  } catch {
    return NextResponse.json({ error: "The passport could not be built just now. Please try again." }, { status: 503 });
  }
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="result-passport.pdf"', "Cache-Control": "private, no-store" },
  });
}
