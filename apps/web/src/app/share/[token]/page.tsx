import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

export const metadata: Metadata = {
  title: "Shared health record",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SharedData = {
  full_name: string;
  shared_at: string;
  expires_at: string;
  sections: string[];
  vitals?: Array<{
    vital_type: string;
    systolic: number | null;
    diastolic: number | null;
    pulse_bpm: number | null;
    glucose_mmol: number | null;
    weight_kg: number | null;
    temperature_c: number | null;
    spo2_pct: number | null;
    source: string;
    taken_at: string;
  }>;
  medications?: Array<{
    drug_name: string;
    dose: string | null;
    frequency: string | null;
    is_active: boolean;
  }>;
  conditions?: string[];
  allergies?: Array<{
    allergen: string;
    reaction: string | null;
    severity: string | null;
  }>;
  lab_results?: Array<{
    code: string;
    value: number | null;
    value_text: string | null;
    unit: string | null;
    reference_range_text: string | null;
    abnormal_flag: string | null;
    taken_at: string;
    laboratory: string | null;
  }>;
  vaccinations?: Array<{
    vaccine_name: string | null;
    date_administered: string | null;
    dose_number: number | null;
    batch_number: string | null;
  }>;
  emergency_info?: {
    blood: {
      blood_group: string | null;
      genotype: string | null;
      source: string | null;
    } | null;
    emergency_contact: {
      name: string;
      phone: string;
      relationship: string | null;
    } | null;
  };
};

async function loadSharedRecord(token: string): Promise<SharedData | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  const supabase = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("record_share_by_token", {
    p_token: token,
  });
  if (error || !data) return null;
  return data as unknown as SharedData;
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Vital = NonNullable<SharedData["vitals"]>[number];

function vitalDisplay(v: Vital): string {
  switch (v.vital_type) {
    case "blood_pressure":
      return `${v.systolic ?? "-"}/${v.diastolic ?? "-"} mmHg${v.pulse_bpm ? ` (pulse ${v.pulse_bpm})` : ""}`;
    case "glucose":
      return `${v.glucose_mmol ?? "-"} mmol/L`;
    case "weight":
      return `${v.weight_kg ?? "-"} kg`;
    case "temperature":
      return `${v.temperature_c ?? "-"} C`;
    case "spo2":
      return `${v.spo2_pct ?? "-"}%`;
    case "pulse":
      return `${v.pulse_bpm ?? "-"} bpm`;
    default:
      return "-";
  }
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-6 mb-3 text-sm font-semibold uppercase tracking-wide text-charcoal-ink/60">
      {children}
    </h2>
  );
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const record = await loadSharedRecord(token);

  if (!record) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="text-lg font-semibold text-charcoal-ink">
          This link is not available
        </h1>
        <p className="mt-2 text-sm text-charcoal-ink/70">
          This share link is not valid, has expired, or the person it belongs to
          has withdrawn it.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg p-6">
      <header className="mb-6">
        <p className="text-xs font-medium uppercase tracking-wide text-tarragon-green">
          TarragonHealth
        </p>
        <h1 className="mt-1 text-xl font-semibold text-charcoal-ink">
          Shared health record
        </h1>
        <p className="mt-1 text-sm text-charcoal-ink/70">
          Shared by {record.full_name}
        </p>
        <p className="text-sm text-charcoal-ink/70">
          Expires {formatDate(record.expires_at)}
        </p>
      </header>

      {record.vitals && record.vitals.length > 0 && (
        <>
          <SectionHeading>Vitals</SectionHeading>
          <div className="space-y-2">
            {record.vitals.map((v, i) => (
              <div
                key={i}
                className="flex items-baseline justify-between rounded-lg border border-charcoal-ink/10 px-3 py-2"
              >
                <div>
                  <span className="text-sm font-medium text-charcoal-ink">
                    {v.vital_type.replace(/_/g, " ")}
                  </span>
                  <span className="ml-2 text-sm text-charcoal-ink/70">
                    {vitalDisplay(v)}
                  </span>
                </div>
                <span className="text-xs text-charcoal-ink/50">
                  {formatDateTime(v.taken_at)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {record.medications && record.medications.length > 0 && (
        <>
          <SectionHeading>Medications</SectionHeading>
          <ul className="space-y-1">
            {record.medications.map((m, i) => (
              <li
                key={i}
                className="rounded-lg border border-charcoal-ink/10 px-3 py-2 text-sm"
              >
                <span className="font-medium text-charcoal-ink">
                  {m.drug_name}
                </span>
                {m.dose && (
                  <span className="ml-1 text-charcoal-ink/70">{m.dose}</span>
                )}
                {m.frequency && (
                  <span className="ml-1 text-charcoal-ink/50">
                    ({m.frequency})
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {record.conditions && record.conditions.length > 0 && (
        <>
          <SectionHeading>Conditions</SectionHeading>
          <ul className="flex flex-wrap gap-2">
            {record.conditions.map((c, i) => (
              <li
                key={i}
                className="rounded-full border border-charcoal-ink/10 px-3 py-1 text-sm text-charcoal-ink"
              >
                {c.replace(/_/g, " ")}
              </li>
            ))}
          </ul>
        </>
      )}

      {record.allergies && record.allergies.length > 0 && (
        <>
          <SectionHeading>Allergies</SectionHeading>
          <ul className="space-y-1">
            {record.allergies.map((a, i) => (
              <li
                key={i}
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm dark:border-red-900/30 dark:bg-red-950/20"
              >
                <span className="font-medium text-charcoal-ink">
                  {a.allergen}
                </span>
                {a.reaction && (
                  <span className="ml-1 text-charcoal-ink/70">
                    {a.reaction}
                  </span>
                )}
                {a.severity && (
                  <span className="ml-1 text-xs text-red-600">
                    {a.severity}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {record.lab_results && record.lab_results.length > 0 && (
        <>
          <SectionHeading>Lab results</SectionHeading>
          <div className="space-y-2">
            {record.lab_results.map((lr, i) => (
              <div
                key={i}
                className="rounded-lg border border-charcoal-ink/10 px-3 py-2"
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium text-charcoal-ink">
                    {lr.code}
                  </span>
                  <span className="text-xs text-charcoal-ink/50">
                    {formatDateTime(lr.taken_at)}
                  </span>
                </div>
                <p className="text-sm text-charcoal-ink/70">
                  {lr.value_text ?? lr.value ?? "-"} {lr.unit ?? ""}
                  {lr.reference_range_text && (
                    <span className="ml-2 text-xs text-charcoal-ink/50">
                      (ref: {lr.reference_range_text})
                    </span>
                  )}
                  {lr.abnormal_flag && (
                    <span className="ml-2 text-xs font-semibold text-red-600">
                      {lr.abnormal_flag}
                    </span>
                  )}
                </p>
              </div>
            ))}
          </div>
        </>
      )}

      {record.vaccinations && record.vaccinations.length > 0 && (
        <>
          <SectionHeading>Vaccinations</SectionHeading>
          <ul className="space-y-1">
            {record.vaccinations.map((v, i) => (
              <li
                key={i}
                className="rounded-lg border border-charcoal-ink/10 px-3 py-2 text-sm"
              >
                <span className="font-medium text-charcoal-ink">
                  {v.vaccine_name ?? "Vaccine"}
                </span>
                {v.dose_number && (
                  <span className="ml-1 text-charcoal-ink/70">
                    Dose {v.dose_number}
                  </span>
                )}
                {v.date_administered && (
                  <span className="ml-2 text-xs text-charcoal-ink/50">
                    {formatDate(v.date_administered)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {record.emergency_info && (
        <>
          <SectionHeading>Emergency info</SectionHeading>
          <div className="space-y-2">
            {record.emergency_info.blood && (
              <div className="rounded-lg border border-charcoal-ink/10 px-3 py-2 text-sm">
                <span className="font-medium text-charcoal-ink">Blood: </span>
                {record.emergency_info.blood.blood_group && (
                  <span>{record.emergency_info.blood.blood_group}</span>
                )}
                {record.emergency_info.blood.genotype && (
                  <span className="ml-2">
                    Genotype: {record.emergency_info.blood.genotype}
                  </span>
                )}
              </div>
            )}
            {record.emergency_info.emergency_contact && (
              <div className="rounded-lg border border-charcoal-ink/10 px-3 py-2 text-sm">
                <span className="font-medium text-charcoal-ink">
                  Emergency contact:{" "}
                </span>
                <span>
                  {record.emergency_info.emergency_contact.name}
                  {record.emergency_info.emergency_contact.relationship &&
                    ` (${record.emergency_info.emergency_contact.relationship})`}
                </span>
              </div>
            )}
          </div>
        </>
      )}

      <footer className="mt-8 rounded-lg bg-charcoal-ink/5 p-4 text-xs text-charcoal-ink/60 dark:bg-charcoal-ink/10">
        <p>
          This is a summary shared by the patient through TarragonHealth. It is
          not a complete medical record and may be out of date. It does not
          replace your own assessment. The patient can withdraw this link at any
          time.
        </p>
        <p className="mt-1">
          Viewing this page is recorded and shown to the patient.
        </p>
      </footer>
    </main>
  );
}
