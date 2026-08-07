import { createClient } from "@/lib/supabase/server";
import { getHealthPassportData } from "@/lib/health-passport/get-health-passport-data";
import { renderUnsignedPassportPdf } from "@/lib/health-passport/render";

/**
 * The Annual Health Check "Smart Report" — a branded, take-anywhere PDF of
 * the patient's record (the Apollo/Tata-1mg consumer-report pattern). Same
 * verified read-side data and layout as the Health Passport (a title
 * override on the same document component) — no new data surface, no claims
 * beyond what the in-app views already show.
 * Cookie-session auth; every query scoped to the caller's own patient_id.
 *
 * Deliberately UNSIGNED, and it should stay that way. This is an internal
 * summary the patient reads themselves, not a credential handed to an
 * institution — issuing it with a verification reference would put a second,
 * competing verifiable document into circulation alongside the Health Passport
 * and blur what the reference means. It shares the branded layout, and says on
 * its own face that it carries no reference a third party can check.
 */
export async function GET(): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("Not signed in", { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, organisation_id, role")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id || profile.role !== "patient") {
    return new Response("Not found", { status: 404 });
  }

  const data = await getHealthPassportData(supabase, user.id, profile.organisation_id);
  const buffer = await renderUnsignedPassportPdf(
    profile.full_name ?? "Patient",
    data,
    "Annual Health Check Report"
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="annual-health-check-report.pdf"',
      "Cache-Control": "no-store, private",
    },
  });
}
