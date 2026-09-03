import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import {
  ReferralLetterDocument,
  type ReferralLetterData,
  type ReferralVital,
} from "@/lib/referrals/referral-letter-document";

/**
 * The take-anywhere specialist referral letter.
 *
 * Cookie-session auth, every read through the caller's own RLS-scoped session:
 * specialist_referrals_select admits the patient themselves, org staff, or a
 * consented clinical reader, so a foreign referralId returns nothing and this
 * 404s rather than confirming the referral exists.
 *
 * Never gated by plan. A patient holding a referral must always be able to
 * print it, whatever they pay.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ referralId: string }> },
): Promise<Response> {
  const { referralId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const { data: referral } = await supabase
    .from("specialist_referrals")
    .select(
      "id, referral_number, created_at, patient_id, specialist_type, urgency, referral_reason, requested_service, interim_management_plan, clinical_summary, set_by",
    )
    .eq("id", referralId)
    .maybeSingle();
  if (!referral) return new Response("Not found", { status: 404 });

  const { data: patient } = await supabase
    .from("profiles")
    .select("full_name, patient_number, date_of_birth, sex")
    .eq("id", referral.patient_id)
    .maybeSingle();
  if (!patient) return new Response("Not found", { status: 404 });

  // clinical_summary is assembled by the clinician's own "assemble" action
  // (clinician/referrals/[referralId]/actions.ts). A referral with none yet
  // still prints: the letter degrades to reason + patient rather than refusing,
  // because a patient who needs to be seen should not be blocked by a step
  // their care team has not got to.
  const summary = (referral.clinical_summary ?? {}) as {
    vitals?: ReferralVital[];
    medications?: { drug_name: string; dose: string | null; frequency: string | null }[];
    triggering_result?: {
      result_status?: string | null;
      result_summary?: string | null;
      created_at?: string | null;
    } | null;
    clinical_question?: string | null;
  };

  // Null-gated attribution, same rule as ReviewedByDoctor: a name appears only
  // when a real clinical_staff row backs it.
  let referrerName: string | null = null;
  let referrerCredentialType: string | null = null;
  let referrerCredential: string | null = null;
  if (referral.set_by) {
    const { data: staff } = await supabase
      .from("clinical_staff")
      .select("full_name, credential_type, credential_number")
      .eq("profile_id", referral.set_by)
      .eq("active", true)
      .maybeSingle();
    if (staff?.full_name) {
      referrerName = staff.full_name;
      referrerCredentialType = staff.credential_type;
      referrerCredential = staff.credential_number;
    }
  }

  const data: ReferralLetterData = {
    patientName: patient.full_name ?? "Patient",
    patientNumber: patient.patient_number,
    dateOfBirth: patient.date_of_birth,
    sex: patient.sex,
    referralNumber: referral.referral_number,
    createdAt: referral.created_at,
    specialistType: referral.specialist_type,
    urgency: referral.urgency,
    reason: referral.referral_reason ?? summary.clinical_question ?? null,
    requestedService: referral.requested_service,
    interimPlan: referral.interim_management_plan,
    vitals: summary.vitals ?? [],
    medications: summary.medications ?? [],
    triggeringResult: summary.triggering_result ?? null,
    referrerName,
    referrerCredentialType,
    referrerCredential,
  };

  const buffer = await renderToBuffer(ReferralLetterDocument({ data }));
  const filename = referral.referral_number
    ? `tarragon-referral-${referral.referral_number}.pdf`
    : "tarragon-referral.pdf";

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
