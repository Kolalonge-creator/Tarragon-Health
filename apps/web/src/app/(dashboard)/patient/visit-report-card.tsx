import { ALLOWED_PERIOD_DAYS } from "@/lib/visit-report/summarise";

/**
 * A PDF of the readings the patient has logged, for an appointment. Plain
 * links to the PDF route, so it works without JavaScript and on slow
 * connections.
 */
export function VisitReportCard() {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-base font-semibold">Report for your visit</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        A one-page summary of your blood pressure, blood sugar, pulse and weight to take to an
        appointment.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {ALLOWED_PERIOD_DAYS.map((days) => (
          <a
            key={days}
            href={`/api/patient/visit-report/pdf?days=${days}`}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
          >
            Last {days} days (PDF)
          </a>
        ))}
      </div>
    </section>
  );
}
