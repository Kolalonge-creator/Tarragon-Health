import { createClient } from "@/lib/supabase/server";
import { getHealthPassportData } from "@/lib/health-passport/get-health-passport-data";
import { getCurrentPassport, issueHealthPassport } from "@/lib/health-passport/issue";
import { renderPassportPdf, renderUnsignedPassportPdf } from "@/lib/health-passport/render";

/**
 * The Health Passport download.
 *
 * Three paths, in order of preference:
 *
 *   1. The patient already holds a current passport — re-render THAT one, from
 *      its frozen snapshot. Downloading a second copy must produce the same
 *      document with the same reference, not silently supersede the copy already
 *      sitting in an embassy's file.
 *   2. They hold none — issue one, sign it, seal it, render it.
 *   3. No signing key is configured on this deployment — hand them their record
 *      as an honestly-labelled unsigned summary. See lib/health-passport/signing-key.ts
 *      for why that degradation is right and a fabricated signature never is.
 *
 * Cookie-session auth: this is a browser link, not a mobile bearer-token call.
 * Every query underneath is already scoped to the caller's own patient_id, so
 * this exposes nothing the in-app page would not.
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
    .select("full_name, organisation_id, role, receives_care")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id || profile.role !== "patient" || !profile.receives_care) {
    return new Response("Not found", { status: 404 });
  }

  const existing = await getCurrentPassport(supabase, user.id);
  const issuance =
    existing ??
    (await (async () => {
      const result = await issueHealthPassport(
        supabase,
        user.id,
        profile.organisation_id as string
      );
      return result.ok ? result.issuance : null;
    })());

  if (issuance) {
    const pdf = await renderPassportPdf(issuance);
    if (pdf) {
      return pdfResponse(pdf, `tarragon-health-passport-${issuance.serial}.pdf`);
    }
  }

  // Unsigned fallback. Reached when no signing key is configured, or in the rare
  // case where a sealed row could not be rendered — either way the patient gets
  // their own record rather than an error page.
  const data = await getHealthPassportData(supabase, user.id, profile.organisation_id);
  const pdf = await renderUnsignedPassportPdf(profile.full_name ?? "Patient", data);
  return pdfResponse(pdf, "tarragon-health-summary.pdf");
}

function pdfResponse(buffer: Buffer, filename: string): Response {
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // A passport is personal and is regenerated on demand; nothing in the
      // chain between here and the patient's disk should keep a copy.
      "Cache-Control": "no-store, private",
    },
  });
}
