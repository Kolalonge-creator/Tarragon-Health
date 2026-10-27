import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { requestSchema, summaryConfig, SECTION_KEYS, usesPassportSections } from "@/lib/doctor-summary-pdf/model";
import { isPassportOpen } from "@/lib/doctor-summary-pdf/passport-guard";
import { loadDoctorSummary, recordSummaryGeneration } from "@/lib/doctor-summary-pdf/load";
import { DoctorSummaryPdfDocument } from "@/lib/doctor-summary-pdf/document";

/**
 * The patient-generated visit summary (spec 2.9): blood pressure, medicines, adherence and symptoms in one PDF for any facility.
 * A POST from a plain form (no JavaScript needed), so a link preview or a prefetch can never generate one and write an audit
 * row. Cookie-session auth; every read runs under the caller's own session and is keyed on her own id, so there is no way to
 * ask for anyone else's record, and a person acting for someone else cannot build one for them (the route has no patient id).
 *
 * Order matters: validate, then write the audit row, then read, then render. If the audit row cannot be written nothing is read.
 * If any ticked section cannot be read the answer is a 503 with no document, never a PDF that quietly lacks a section.
 */
export async function POST(request: Request): Promise<Response> {
  // A cross-site form post carries the cookie; refuse one whose Origin is not this host.
  const origin = request.headers.get("origin");
  if (origin) {
    let sameHost = false;
    try {
      sameHost = new URL(origin).host === new URL(request.url).host;
    } catch {
      sameHost = false; // "null" or any malformed Origin
    }
    if (!sameHost) return new Response("Forbidden", { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("organisation_id, role").eq("id", user.id).maybeSingle();
  if (!profile?.organisation_id || profile.role !== "patient") return new Response("Not found", { status: 404 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const cfg = summaryConfig();
  const parsed = requestSchema(cfg).safeParse({
    days: form.get("days") as string | null,
    sections: form.getAll("section").map(String).filter((s) => (SECTION_KEYS as readonly string[]).includes(s)),
  });
  if (!parsed.success) return new Response("Choose at least one section and a period.", { status: 400 });

  // The result passport sections (blood sugar, lab results) exist only while their go-live guard is open. Nothing is read or audited before this.
  if (usesPassportSections(parsed.data.sections) && !(await isPassportOpen(supabase))) {
    return new Response("The result passport is not switched on yet.", { status: 404 });
  }

  const audited = await recordSummaryGeneration(supabase, { id: user.id, organisationId: profile.organisation_id }, parsed.data);
  if (!audited.ok) return new Response("The summary could not be built just now. Please try again.", { status: 503 });

  const result = await loadDoctorSummary(supabase, user.id, parsed.data, Date.now(), cfg);
  if (!result.ok) return new Response("The summary could not be built just now. Please try again.", { status: 503 });

  let buffer: Buffer;
  try {
    buffer = await renderToBuffer(DoctorSummaryPdfDocument({ data: result.data }));
  } catch {
    return new Response("The summary could not be built just now. Please try again.", { status: 503 });
  }
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="visit-summary.pdf"',
      "Cache-Control": "private, no-store",
    },
  });
}
