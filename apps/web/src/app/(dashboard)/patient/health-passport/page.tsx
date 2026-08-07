import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { getHealthPassportData } from "@/lib/health-passport/get-health-passport-data";
import { listPassports, passportVerifyUrl } from "@/lib/health-passport/issue";
import { getSigner } from "@/lib/health-passport/signing-key";
import { formatPassportDate, formatPassportPeriod } from "@/lib/health-passport/format";
import { formatHba1cWithBracket } from "@/lib/rules/hba1c-bracket";
import { LIPID_ANALYTE_META, isLipidAnalyteCode } from "@/lib/lipids/analytes";
import { ReviewedByDoctor } from "@/components/reviewed-by-doctor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PassportManager,
  type AttestationSummary,
  type PassportSummary,
} from "./passport-manager";

const VITAL_LABEL: Record<string, string> = {
  blood_pressure: "Blood pressure",
  glucose: "Glucose",
  weight: "Weight",
  pulse: "Heart rate",
  temperature: "Temperature",
  spo2: "SpO2",
};

// Patient-facing label for a lab analyte code: known lipid codes get their
// proper names; anything else is humanised (hba1c → HBA1C was the old
// behaviour — underscored codes must never surface raw in patient copy).
function labResultLabel(code: string): string {
  if (isLipidAnalyteCode(code)) return LIPID_ANALYTE_META[code].label;
  if (code === "hba1c") return "HbA1c";
  const words = code.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function formatVitalValue(vitalType: string, latest: Record<string, unknown>): string {
  switch (vitalType) {
    case "blood_pressure":
      return `${latest.systolic}/${latest.diastolic} mmHg`;
    case "glucose":
      return `${latest.glucose_mmol_l} mmol/L`;
    case "weight":
      return `${latest.weight_kg} kg`;
    case "pulse":
      return `${latest.pulse_bpm} bpm`;
    case "temperature":
      return `${latest.temperature_c}°C`;
    case "spo2":
      return `${latest.spo2_pct}%`;
    default:
      return "—";
  }
}

export default async function HealthPassportPage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }
  if (profile.role !== "patient") {
    redirect("/");
  }
  if (!profile.onboarding_completed_at) {
    redirect("/onboarding");
  }
  if (!profile.organisation_id) {
    redirect("/patient");
  }

  const supabase = await createClient();
  const [data, issuances, attestationRows] = await Promise.all([
    getHealthPassportData(supabase, profile.id, profile.organisation_id),
    listPassports(supabase, profile.id),
    supabase
      .from("health_passport_attestation_requests")
      .select("id, status, purpose, requested_at, reviewed_at, decline_reason")
      .eq("patient_id", profile.id)
      .order("requested_at", { ascending: false })
      .limit(10),
  ]);

  const passports: PassportSummary[] = issuances.map((row) => ({
    id: row.id,
    serial: row.serial,
    status: row.status as PassportSummary["status"],
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    verifyUrl: passportVerifyUrl(row.serial),
    verificationCount: row.verification_count,
    lastVerifiedAt: row.last_verified_at,
    attestingDoctorName: row.attesting_doctor_name,
    attestingCredentialType: row.attesting_credential_type,
    attestingCredentialNumber: row.attesting_credential_number,
    isExpired: row.isExpired,
  }));

  // An attestation is single-use: once a passport has been issued against it,
  // offering it again would let the same review back a second document without
  // the doctor ever looking at the record a second time.
  const usedAttestationIds = new Set(
    issuances.map((row) => row.attestation_request_id).filter((id): id is string => id !== null)
  );
  const attestations: AttestationSummary[] = (attestationRows.data ?? []).map((row) => ({
    id: row.id,
    status: row.status as AttestationSummary["status"],
    purpose: row.purpose,
    requestedAt: row.requested_at,
    reviewedAt: row.reviewed_at,
    declineReason: row.decline_reason,
    used: usedAttestationIds.has(row.id),
  }));

  const periodLabel = formatPassportPeriod(data.periodStart, data.periodEnd);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Your Health Passport
        </h1>
        <p className="text-charcoal-ink/60">
          Your health record for {periodLabel}, issued as a document that an employer, a clinic, an
          insurer or an embassy can check for themselves, with no account needed on their side. Not a
          substitute for your full medical record.
        </p>
      </div>

      <PassportManager
        passports={passports}
        attestations={attestations}
        signingAvailable={getSigner() !== null}
      />

      <h2 className="pt-2 font-heading text-lg font-semibold text-charcoal-ink">
        What the passport contains
      </h2>

      <Card>
        <CardHeader>
          <CardTitle>Vitals</CardTitle>
        </CardHeader>
        <CardContent>
          {data.vitals.length === 0 && data.bmi === null && (
            <p className="text-sm text-charcoal-ink/60">No vitals logged in this period.</p>
          )}
          {(data.vitals.length > 0 || data.bmi !== null) && (
            <ul className="divide-y divide-charcoal-ink/10">
              {data.bmi !== null && (
                <li className="flex items-center justify-between py-2">
                  <span className="text-sm font-medium text-charcoal-ink">BMI</span>
                  <span className="text-sm text-charcoal-ink/60">{data.bmi} kg/m²</span>
                </li>
              )}
              {data.vitals.map((v) => (
                <li key={v.vitalType} className="flex items-center justify-between py-2">
                  <span className="text-sm font-medium text-charcoal-ink">
                    {VITAL_LABEL[v.vitalType] ?? v.vitalType}
                  </span>
                  <span className="text-sm text-charcoal-ink/60">
                    {formatVitalValue(v.vitalType, v.latest)} · {v.readingCount} readings this
                    period · last logged {formatPassportDate(v.takenAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preventive screenings</CardTitle>
        </CardHeader>
        <CardContent>
          {data.screenings.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">No screenings due in this period.</p>
          )}
          {data.screenings.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {data.screenings.map((s, i) => (
                <li key={i} className="py-2">
                  <p className="text-sm font-medium text-charcoal-ink">
                    {s.screenTypeName}: {s.status}
                  </p>
                  {s.resultStatus && (
                    <p className="text-xs text-charcoal-ink/60">
                      Result: {s.resultStatus}
                      {s.resultSummary ? `, ${s.resultSummary}` : ""}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lab results</CardTitle>
        </CardHeader>
        <CardContent>
          {data.labReadings.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">No lab results on file this period.</p>
          )}
          {data.labReadings.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {data.labReadings.map((r, i) => (
                <li key={i} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-medium text-charcoal-ink">{labResultLabel(r.code)}</span>
                  <span className="text-charcoal-ink/60">
                    {r.code === "hba1c" ? formatHba1cWithBracket(r.value) : `${r.value} ${r.unit}`} ·{" "}
                    {formatPassportDate(r.takenAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {data.reviewedEscalations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Direct doctor review</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.reviewedEscalations.map((esc) => (
              <div key={esc.id} className="space-y-1 border-b border-charcoal-ink/10 pb-3 last:border-0">
                <p className="text-sm text-charcoal-ink/70">{esc.reason}</p>
                <ReviewedByDoctor escalationId={esc.id} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-charcoal-ink/60">
        {data.protocolAuthor
          ? `Protocols supervised by Dr. ${data.protocolAuthor.fullName}${
              data.protocolAuthor.credentialType && data.protocolAuthor.credentialNumber
                ? ` · ${data.protocolAuthor.credentialType} ${data.protocolAuthor.credentialNumber}`
                : ""
            }.`
          : "Protocols supervised by your care team's Clinical Director."}
      </p>
    </div>
  );
}
