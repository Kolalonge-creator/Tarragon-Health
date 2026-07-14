import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { getHealthPassportData } from "@/lib/health-passport/get-health-passport-data";
import { ReviewedByDoctor } from "@/components/reviewed-by-doctor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const VITAL_LABEL: Record<string, string> = {
  blood_pressure: "Blood pressure",
  glucose: "Glucose",
  weight: "Weight",
  pulse: "Pulse",
  temperature: "Temperature",
  spo2: "SpO2",
};

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
  const data = await getHealthPassportData(supabase, profile.id, profile.organisation_id);

  const periodLabel = `${new Date(data.periodStart).toLocaleDateString()} – ${new Date(
    data.periodEnd
  ).toLocaleDateString()}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
            Your Health Passport
          </h1>
          <p className="text-charcoal-ink/60">
            A summary of your health record for {periodLabel} — for your own records or to
            share with another clinician. Not a substitute for your full medical record.
          </p>
        </div>
        <Link
          href="/api/patient/health-passport/pdf"
          className="rounded-md bg-brand-green px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Download PDF
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Vitals</CardTitle>
        </CardHeader>
        <CardContent>
          {data.vitals.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">No vitals logged in this period.</p>
          )}
          {data.vitals.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {data.vitals.map((v) => (
                <li key={v.vitalType} className="flex items-center justify-between py-2">
                  <span className="text-sm font-medium text-charcoal-ink">
                    {VITAL_LABEL[v.vitalType] ?? v.vitalType}
                  </span>
                  <span className="text-sm text-charcoal-ink/60">
                    {formatVitalValue(v.vitalType, v.latest)} · {v.readingCount} readings this
                    period
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
                    {s.screenTypeName} — {s.status}
                  </p>
                  {s.resultStatus && (
                    <p className="text-xs text-charcoal-ink/60">
                      Result: {s.resultStatus}
                      {s.resultSummary ? ` — ${s.resultSummary}` : ""}
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
                  <span className="font-medium text-charcoal-ink">{r.code.toUpperCase()}</span>
                  <span className="text-charcoal-ink/60">
                    {r.value} {r.unit} · {new Date(r.takenAt).toLocaleDateString()}
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
