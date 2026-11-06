import Link from "next/link";

/**
 * "Open work" line in the patient-record header (doctor workspace spec 11.1, 28): how many escalations and clinical
 * alerts are still open for this patient, with a link to act on each. A count that did not load says so; it is never
 * drawn as "nothing open".
 */
export type OpenCount = { state: "known"; value: number } | { state: "unknown" };

export function PatientOpenWork({ escalations, alerts }: { escalations: OpenCount; alerts: OpenCount }) {
  if (escalations.state === "unknown" || alerts.state === "unknown") {
    return (
      <p className="text-sm text-amber-800">
        Open escalations and alerts for this patient could not be loaded. Do not read this as none open; check the{" "}
        <Link href="/clinician/escalations" className="underline">
          escalations list
        </Link>
        .
      </p>
    );
  }
  if (escalations.value === 0 && alerts.value === 0) {
    return <p className="text-sm text-charcoal-ink/70">No open escalations or clinical alerts.</p>;
  }
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return (
    <p className="text-sm font-medium text-charcoal-ink">
      Open for this patient:{" "}
      {escalations.value > 0 && (
        <Link href="/clinician/escalations" className="text-brand-green underline">
          {plural(escalations.value, "escalation", "escalations")}
        </Link>
      )}
      {escalations.value > 0 && alerts.value > 0 && ", "}
      {alerts.value > 0 && (
        <Link href="/clinician#clinical-alerts" className="text-brand-green underline">
          {plural(alerts.value, "clinical alert", "clinical alerts")}
        </Link>
      )}
    </p>
  );
}
