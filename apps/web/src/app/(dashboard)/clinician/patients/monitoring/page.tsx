import Link from "next/link";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { loadPatientMonitoringRoster } from "@/lib/queries/patient-monitoring";
import { PatientMonitoringCard } from "./patient-monitoring-card";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ExportButton } from "@/app/(dashboard)/analytics/_components/export-button";
import type { CsvRow } from "@/lib/analytics/to-csv";

const AGE_BANDS = {
  all: { label: "All ages", test: () => true },
  "0-17": { label: "Under 18", test: (age: number) => age < 18 },
  "18-39": { label: "18–39", test: (age: number) => age >= 18 && age <= 39 },
  "40-59": { label: "40–59", test: (age: number) => age >= 40 && age <= 59 },
  "60+": { label: "60+", test: (age: number) => age >= 60 },
} as const;
type AgeBand = keyof typeof AGE_BANDS;

/**
 * Card-grid vitals overview for org clinical staff — a Patient Monitoring
 * view alongside the plain roster list at /clinician/patients. Every value
 * shown here already exists (vitals_readings, wearable_readings,
 * clinician_alerts); this only aggregates and colour-codes it. Institutions/
 * non-clinical admins never get this view — see CLAUDE.md's I9
 * (aggregate-only patient access for institutions, individual drill-down is
 * clinical-staff/superadmin only) — this stays under /clinician, gated the
 * same way as the rest of the clinician dashboard.
 */
export default async function PatientMonitoringPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; mine?: string; status?: string; gender?: string; age?: string }>;
}) {
  const { q, mine, status, gender, age } = await searchParams;
  const showMineOnly = mine === "1";
  const statusFilter = status === "normal" || status === "exception" ? status : "all";
  const genderFilter = gender === "male" || gender === "female" ? gender : "all";
  const ageFilter: AgeBand = age && age in AGE_BANDS ? (age as AgeBand) : "all";

  const supabase = await createClient();
  const currentUser = showMineOnly ? await getCurrentUser() : null;

  const roster = await loadPatientMonitoringRoster(supabase, {
    q,
    mineOnly: showMineOnly,
    callerId: currentUser?.id ?? null,
  });

  const patients = roster.filter((p) => {
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    if (genderFilter !== "all" && p.sex !== genderFilter) return false;
    if (ageFilter !== "all") {
      if (p.ageYears == null || !AGE_BANDS[ageFilter].test(p.ageYears)) return false;
    }
    return true;
  });

  const exceptionCount = patients.filter((p) => p.status === "exception").length;

  // Builds a query string for the "Everyone"/"Assigned to me" links, carrying
  // every other filter forward so switching the toggle doesn't reset them —
  // same intent as clinician/patients/page.tsx's search-preserving mine link,
  // extended to this page's extra filters.
  function queryWith(overrides: Partial<{ q: string; mine: string; status: string; gender: string; age: string }>) {
    const merged = { q, mine: showMineOnly ? "1" : undefined, status, gender, age, ...overrides };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    const qs = params.toString();
    return qs ? `?${qs}` : "?";
  }

  const csvRows: CsvRow[] = patients.map((p) => ({
    name: p.fullName,
    patient_number: p.patientNumber ?? "",
    status: p.status,
    heart_rate_bpm: p.vitals.pulse.value ?? "",
    blood_pressure: p.vitals.bp.systolic != null ? `${p.vitals.bp.systolic}/${p.vitals.bp.diastolic}` : "",
    spo2_pct: p.vitals.spo2.value ?? "",
    glucose_mmol_l: p.vitals.glucose.value ?? "",
    temperature_c: p.vitals.temperature.value ?? "",
    weight_kg: p.vitals.weight.value ?? "",
    last_synced: p.wearable.lastSyncedAt ?? "",
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Patient monitoring</h1>
          <p className="text-sm text-charcoal-ink/60">
            Latest vitals across your roster. {exceptionCount} of {patients.length} need a look.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={mine === "1" ? "/clinician/patients?mine=1" : "/clinician/patients"}
            className="rounded-lg border border-charcoal-ink/15 bg-white px-3 py-2 text-sm font-medium text-charcoal-ink/70 hover:text-charcoal-ink"
          >
            List view
          </Link>
          <ExportButton filename="patient-monitoring" rows={csvRows} />
        </div>
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-3">
        {showMineOnly && <input type="hidden" name="mine" value="1" />}
        <div className="space-y-1">
          <Label htmlFor="q" className="text-xs">
            Search by name
          </Label>
          <input
            id="q"
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Patient name"
            className="w-full max-w-xs rounded-lg border border-charcoal-ink/15 bg-white px-3 py-2 text-sm text-charcoal-ink placeholder:text-charcoal-ink/40 focus:border-brand-green focus:outline-none"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="status" className="text-xs">
            Status
          </Label>
          <Select id="status" name="status" defaultValue={statusFilter} className="w-40">
            <option value="all">All</option>
            <option value="exception">Exception</option>
            <option value="normal">Normal</option>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="gender" className="text-xs">
            Gender
          </Label>
          <Select id="gender" name="gender" defaultValue={genderFilter} className="w-36">
            <option value="all">All</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="age" className="text-xs">
            Age
          </Label>
          <Select id="age" name="age" defaultValue={ageFilter} className="w-36">
            {Object.entries(AGE_BANDS).map(([value, band]) => (
              <option key={value} value={value}>
                {band.label}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" size="sm">
          Apply filters
        </Button>
        <div className="ml-auto flex gap-1 rounded-lg border border-charcoal-ink/15 bg-white p-1 text-sm">
          <Link
            href={queryWith({ mine: undefined })}
            className={`rounded-md px-3 py-1.5 font-medium ${
              !showMineOnly ? "bg-brand-green/10 text-deep-forest" : "text-charcoal-ink/60 hover:text-charcoal-ink"
            }`}
          >
            Everyone
          </Link>
          <Link
            href={queryWith({ mine: "1" })}
            className={`rounded-md px-3 py-1.5 font-medium ${
              showMineOnly ? "bg-brand-green/10 text-deep-forest" : "text-charcoal-ink/60 hover:text-charcoal-ink"
            }`}
          >
            Assigned to me
          </Link>
        </div>
      </form>

      {patients.length === 0 ? (
        <p className="rounded-xl border border-charcoal-ink/10 bg-white p-6 text-sm text-charcoal-ink/60">
          {showMineOnly
            ? "No patients are assigned to you on the care team yet. Switch to “Everyone” to see the full roster."
            : "No patients match these filters."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {patients.map((patient) => (
            <PatientMonitoringCard key={patient.id} patient={patient} />
          ))}
        </div>
      )}
    </div>
  );
}
