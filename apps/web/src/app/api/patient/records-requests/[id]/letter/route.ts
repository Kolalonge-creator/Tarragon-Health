import { renderToBuffer } from "@react-pdf/renderer";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { RecordsRequestLetterDocument } from "@/lib/records-request/letter-document";
import { buildLetter, lagosToday, loadLetterConfigForVersion, SCOPE_CODES, type ScopeCode } from "@/lib/records-request/letter";

/**
 * GET /api/patient/records-requests/<id>/letter
 *
 * The person's own request letter as an A4 black-and-white PDF. Cookie-session auth; the request is read through `my_records_requests()`, which
 * returns only the signed-in person's own rows, so another person's id is a plain 404. Nothing is sent anywhere: the person prints or hands it over.
 * The wording is unsigned placeholder text from versioned configuration (`records_request.letter`).
 */
const idSchema = z.string().uuid();

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return new Response("Not found", { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const { data: rows, error } = await supabase.rpc("my_records_requests");
  if (error) return new Response("The letter could not be made.", { status: 500 });
  const row = (rows ?? []).find((r) => r.id === id);
  if (!row) return new Response("Not found", { status: 404 });

  const { data: profile } = await supabase.from("profiles").select("full_name, date_of_birth, phone").eq("id", user.id).single();
  if (!profile) return new Response("Not found", { status: 404 });

  // the wording version the request was made with, so a reprint matches the paper already handed over
  const config = loadLetterConfigForVersion(row.letter_version);
  if (!config) return new Response("The letter wording for this request is not available.", { status: 500 });
  if (!profile.full_name || profile.full_name.trim() === "") {
    return Response.json({ error: "Add your full name to your profile before making a letter." }, { status: 422 });
  }
  // a letter already handed over keeps the date it was handed over; a new one is dated today
  const built = buildLetter(config.letter, {
    facilityName: row.facility_name,
    scopes: row.scope_codes.filter((c): c is ScopeCode => (SCOPE_CODES as readonly string[]).includes(c)),
    letterDate: row.requested_at ? lagosToday(new Date(row.requested_at)) : lagosToday(),
    followUpDays: config.responseDays,
    draft: !config.wordingSigned,
    patient: { fullName: profile.full_name, dateOfBirth: profile.date_of_birth ?? null, phone: profile.phone ?? null },
  });

  const buffer = await renderToBuffer(RecordsRequestLetterDocument({ letter: built }));
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="records-request-letter.pdf"',
      "Cache-Control": "no-store",
    },
  });
}
