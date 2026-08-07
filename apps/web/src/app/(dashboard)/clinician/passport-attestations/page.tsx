import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getHealthPassportData } from "@/lib/health-passport/get-health-passport-data";
import { formatPassportPeriod } from "@/lib/health-passport/format";
import {
  canAttestHealthPassport,
  hasAttestableCredential,
  hasCredentialOnRecord,
} from "@/lib/clinical/doctor-tier";
import {
  PassportAttestationList,
  type AttestationRequestItem,
} from "./attestation-list";

/**
 * The worklist for attesting a patient's Health Passport.
 *
 * An attestation is not a clinical decision about a single reading; it is a
 * doctor putting their registration number against a whole record for an
 * audience outside healthcare — an employer, a consulate, a hospital in another
 * country. So the page is built around two things a normal worklist does not
 * need:
 *
 *   IT SAYS WHY YOU CANNOT. Two conditions gate the controls (Tier 2+, and a
 *   registration number on your own staff record), and both are stated in full
 *   rather than leaving a doctor staring at a page with no buttons. As of this
 *   build no real (non-QA-test) staff record carries a registration number, so
 *   in production every doctor currently sees the credential message. That is
 *   the honest surface of a real gap, not a bug to route around: the whole point
 *   of an attested passport is that the institution reading it can look the
 *   doctor up.
 *
 *   IT SHOWS COUNTS, NOT CONTENT. The summary here is deliberately "12 vitals,
 *   3 lab results" and not the values. Attesting a record means having read the
 *   record, in the patient's own chart, with all its context; a convenient
 *   inline digest would invite exactly the skim this document must never be
 *   backed by.
 */
export default async function PassportAttestationsPage() {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) {
    return null;
  }

  const { data: staff } = await supabase
    .from("clinical_staff")
    .select(
      "doctor_tier, is_clinical_director, credential_type, credential_number, credential_verified_at, organisation_id"
    )
    .eq("profile_id", user.id)
    .eq("active", true)
    .maybeSingle();

  const tierOk = canAttestHealthPassport(staff);
  const numberOnFile = hasCredentialOnRecord(staff);
  const credentialOk = hasAttestableCredential(staff);
  const canAttest = tierOk && credentialOk;

  // Three separate conditions, reported separately. "You cannot do this" with no
  // reason sends a doctor to support; naming the missing condition, and who can
  // supply it, is the difference between a blocker and a next step.
  const blockedReason = !staff
    ? "You do not have an active clinical staff record, so you cannot attest a passport."
    : !tierOk
      ? "Attesting a Health Passport needs Tier 2 or above, or Clinical Director status. You can still see who is waiting so the request can be picked up by a colleague."
      : !numberOnFile
        ? "Your staff record does not yet carry a registration authority and number. An attested passport names a registered doctor to an outside institution, so it cannot be issued without one. Ask an administrator to add your MDCN or NMCN details to your record."
        : !credentialOk
          ? "Your registration number is on file but has not been verified by an administrator yet. An attested passport tells an employer or an embassy that this registration can be looked up, so the number has to be checked against the register by someone other than you before it can go on a document. Ask another administrator to verify it under Admin, Clinical staff."
          : null;

  const { data: requests } = await supabase
    .from("health_passport_attestation_requests")
    .select("id, patient_id, purpose, patient_note, requested_at, organisation_id, profiles!health_passport_attestation_requests_patient_id_fkey(full_name, patient_number)")
    .eq("status", "pending")
    .order("requested_at", { ascending: true });

  const items: AttestationRequestItem[] = await Promise.all(
    (requests ?? []).map(async (request) => {
      const profile = request.profiles as unknown as {
        full_name: string | null;
        patient_number: string | null;
      } | null;

      // Counts only. Everything here is already visible to this doctor through
      // the patient's own record; summarising it as totals is a "how much is
      // there" signal for triage, never a substitute for reading it.
      let summary: AttestationRequestItem["summary"] = null;
      try {
        const data = await getHealthPassportData(
          supabase,
          request.patient_id,
          request.organisation_id
        );
        summary = {
          vitals: data.vitals.length,
          labs: data.labReadings.length,
          screenings: data.screenings.length,
          reviewedEscalations: data.reviewedEscalations.length,
          periodLabel: formatPassportPeriod(data.periodStart, data.periodEnd),
        };
      } catch {
        // A summary that cannot be built must not remove the request from the
        // worklist — the doctor reads the chart either way.
        summary = null;
      }

      return {
        id: request.id,
        patientName: profile?.full_name ?? "Patient",
        patientNumber: profile?.patient_number ?? null,
        purpose: request.purpose,
        patientNote: request.patient_note,
        requestedAt: request.requested_at,
        summary,
      };
    })
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Health Passport attestations
        </h1>
        <p className="mt-1 text-sm text-charcoal-ink/60">
          Patients ask for an attested passport when an employer, a clinic, an insurer or an
          immigration process needs a health record from a named doctor rather than an export.
          Attesting adds your name and registration number to a document that can be verified by
          anyone the patient shows it to.
        </p>
      </div>
      <PassportAttestationList
        items={items}
        canAttest={canAttest}
        blockedReason={blockedReason}
      />
    </div>
  );
}
