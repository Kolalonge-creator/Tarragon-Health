import Link from "next/link";

/**
 * "Open work" line in the patient-record header (doctor workspace spec 11.1, 28): how many escalations and clinical
 * alerts are still open for this patient, with a link to act on each. A count that did not load says so; it is never
 * drawn as "nothing open".
 */
export type OpenCount = { state: "known"; value: number } | { state: "unknown" };

export function PatientOpenWork({
  escalations,
  alerts,
  snoozedAlerts = { state: "known", value: 0 },
  onlyEscalationId = null,
}: {
  escalations: OpenCount;
  /** Open and acknowledged: the alerts the home alert list shows and acts on. */
  alerts: OpenCount;
  snoozedAlerts?: OpenCount;
  /** Set when exactly one escalation is open, so the link goes straight to the case. */
  onlyEscalationId?: string | null;
}) {
  if (escalations.state === "unknown" || alerts.state === "unknown" || snoozedAlerts.state === "unknown") {
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
  const snoozed = snoozedAlerts.value;
  if (escalations.value === 0 && alerts.value === 0 && snoozed === 0) {
    return <p className="text-sm text-charcoal-ink/70">No open escalations or clinical alerts.</p>;
  }
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return (
    <p className="text-sm font-medium text-charcoal-ink">
      Open for this patient:{" "}
      {escalations.value > 0 && (
        <Link
          href={onlyEscalationId ? `/clinician/escalations/${onlyEscalationId}` : "/clinician/escalations"}
          className="text-brand-green underline"
        >
          {plural(escalations.value, "escalation", "escalations")}
        </Link>
      )}
      {escalations.value > 0 && alerts.value > 0 && ", "}
      {alerts.value > 0 && (
        <Link href="/clinician#clinical-alerts" className="text-brand-green underline">
          {plural(alerts.value, "clinical alert", "clinical alerts")}
        </Link>
      )}
      {snoozed > 0 && `${escalations.value > 0 || alerts.value > 0 ? ", " : ""}${plural(snoozed, "snoozed alert", "snoozed alerts")}`}
    </p>
  );
}
