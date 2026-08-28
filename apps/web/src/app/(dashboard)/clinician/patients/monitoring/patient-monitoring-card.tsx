import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { VitalTile } from "./vitals-tile";
import type { PatientMonitoringRow } from "@/lib/queries/patient-monitoring";

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatSleep(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return `${hours}h ${mins}m`;
}

export function PatientMonitoringCard({ patient }: { patient: PatientMonitoringRow }) {
  const isException = patient.status === "exception";
  const hasWearableData =
    patient.wearable.hrvMs != null || patient.wearable.sleepMinutes != null || patient.wearable.steps != null;

  return (
    <Link href={`/clinician/patients/${patient.id}`} className="block">
      <Card className={isException ? "border-red-200" : undefined}>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar fullName={patient.fullName} photoUrl={patient.avatarUrl} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-charcoal-ink">{patient.fullName}</p>
              <p className="truncate text-xs text-charcoal-ink/50">
                {patient.patientNumber ?? "No patient number"}
                {patient.ageYears != null ? ` · ${patient.ageYears}y` : ""}
                {patient.sex ? ` · ${patient.sex}` : ""}
              </p>
            </div>
          </div>
          <Badge variant={isException ? "red" : "green"} className="shrink-0">
            {isException ? "Exception" : "Normal"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <VitalTile
              icon="pulse"
              label="Heart rate"
              value={patient.vitals.pulse.value != null ? String(patient.vitals.pulse.value) : null}
              unit="bpm"
            />
            <VitalTile
              icon="bp"
              label="Blood pressure"
              value={
                patient.vitals.bp.systolic != null && patient.vitals.bp.diastolic != null
                  ? `${patient.vitals.bp.systolic}/${patient.vitals.bp.diastolic}`
                  : null
              }
              unit="mmHg"
              level={patient.vitals.bp.level}
            />
            <VitalTile
              icon="spo2"
              label="SpO2"
              value={patient.vitals.spo2.value != null ? String(patient.vitals.spo2.value) : null}
              unit="%"
              level={patient.vitals.spo2.level}
            />
            <VitalTile
              icon="diabetes"
              label="Glucose"
              value={patient.vitals.glucose.value != null ? String(patient.vitals.glucose.value) : null}
              unit="mmol/L"
              level={patient.vitals.glucose.level}
            />
            <VitalTile
              icon="temperature"
              label="Temperature"
              value={patient.vitals.temperature.value != null ? String(patient.vitals.temperature.value) : null}
              unit="°C"
              level={patient.vitals.temperature.level}
            />
            <VitalTile
              icon="weight"
              label="Weight"
              value={patient.vitals.weight.value != null ? String(patient.vitals.weight.value) : null}
              unit="kg"
            />
          </div>

          {hasWearableData && (
            <div className="grid grid-cols-3 gap-2 border-t border-charcoal-ink/10 pt-3">
              <VitalTile
                icon="hrv"
                label="HRV"
                value={patient.wearable.hrvMs != null ? String(Math.round(patient.wearable.hrvMs)) : null}
                unit="ms"
              />
              <VitalTile
                icon="sleep"
                label="Sleep"
                value={patient.wearable.sleepMinutes != null ? formatSleep(patient.wearable.sleepMinutes) : null}
              />
              <VitalTile
                icon="steps"
                label="Steps"
                value={patient.wearable.steps != null ? String(Math.round(patient.wearable.steps)) : null}
              />
            </div>
          )}

          {(patient.openAlertCount > 0 || patient.avgAdherencePct != null || patient.abnormalReadingCount7d > 0) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-charcoal-ink/10 pt-3 text-xs text-charcoal-ink/70">
              {patient.openAlertCount > 0 && (
                <span className="font-medium text-red-700">
                  {patient.openAlertCount} unresolved {patient.openAlertCount === 1 ? "alert" : "alerts"}
                </span>
              )}
              {patient.avgAdherencePct != null && <span>Monitoring adherence: {patient.avgAdherencePct}%</span>}
              {patient.abnormalReadingCount7d > 0 && (
                <span>
                  {patient.abnormalReadingCount7d} abnormal {patient.abnormalReadingCount7d === 1 ? "reading" : "readings"} (7d)
                </span>
              )}
            </div>
          )}

          <p className="text-xs text-charcoal-ink/40">
            {patient.wearable.lastSyncedAt
              ? `Last synced ${timeAgo(patient.wearable.lastSyncedAt)}`
              : "No device connected"}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
