import { createClient } from "@/lib/supabase/server";
import { lagosDateString } from "@/lib/ai-coach/lagos-day";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loadCyclePatternReport } from "@/lib/cycle/pattern-report-read";
import { MENOPAUSE_SYMPTOM_LABEL, type MenopauseSymptomType } from "@/lib/validation/womens-health";
import { PrintReportButton } from "./print-report-button";

/**
 * The clinician cycle and menopause pattern report (S66, 16.3 and 16.4). Cycle-length variability, flow, symptoms, and the menopause log,
 * read through the audited function (INV-10: every opening and every refusal is written to the audit log; INV-12: only a clinician tied
 * to this patient, never break-glass or a support session). Print it, or save it as a PDF from the browser, to bring it into a consultation.
 *
 * Not in the report: notes, temperature, ovulation tests, any fertile-window figure, contraception. Figures are as logged by the patient.
 */
export async function CyclePatternReportPanel({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const outcome = await loadCyclePatternReport(supabase, patientId, lagosDateString());

  if (outcome.kind === "not_open") {
    return (
      <Card variant="soft">
        <CardContent className="py-4 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
          The cycle pattern report is not open yet. It opens once the Chief Medical Officer has reviewed the wording.
        </CardContent>
      </Card>
    );
  }
  if (outcome.kind === "denied") {
    return (
      <Card variant="soft">
        <CardContent className="py-4 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
          You cannot open this patient&apos;s cycle report. It is available to the clinician looking after the patient, and the attempt has been recorded.
        </CardContent>
      </Card>
    );
  }
  if (outcome.kind === "error") {
    return (
      <Card variant="soft">
        <CardContent role="alert" className="py-4 text-sm text-red-700 dark:text-red-300">
          The cycle report could not be loaded just now. This is not the same as there being nothing logged. Please refresh and try again.
        </CardContent>
      </Card>
    );
  }

  const { report, menopause, windowMonths } = outcome;
  const L = report.length;
  return (
    <Card className="print:border-0 print:shadow-none">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Cycle and menopause pattern report</CardTitle>
          <PrintReportButton />
        </div>
        <CardDescription>
          {report.coveredFrom} to {report.coveredTo} ({windowMonths} months). Opening this report is recorded in the audit log.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        {report.flags.length > 0 && (
          <div className="space-y-2">
            {report.flags.map((f) => (
              <p key={f.id}>
                <span className="font-medium">{f.label}.</span> {f.detail}
              </p>
            ))}
          </div>
        )}

        <section aria-labelledby="cpr-length">
          <h3 id="cpr-length" className="font-semibold">Cycle length</h3>
          {L.count === 0 ? (
            <p>Fewer than two periods are logged in this window, so no cycle length can be measured.</p>
          ) : (
            <p>
              {L.count} cycle{L.count === 1 ? "" : "s"} measured. Mean {L.meanDays} days
              {L.sdDays !== null ? `, standard deviation ${L.sdDays}` : ""}; shortest {L.minDays}, longest {L.maxDays} (range {L.rangeDays} days).{" "}
              {L.outsideUsualRangeCount} outside the usual 24 to 38 day range. Regularity: {L.regularity}.
            </p>
          )}
          {report.cycles.length > 0 && (
            <table className="mt-2 w-full max-w-md text-left">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-charcoal-ink/60 dark:text-night-ink/60">
                  <th className="py-1 pr-3 font-medium">Period start</th>
                  <th className="py-1 pr-3 font-medium">Cycle (days)</th>
                  <th className="py-1 font-medium">Bleeding (days)</th>
                </tr>
              </thead>
              <tbody>
                {report.cycles.map((c) => (
                  <tr key={c.startDate}>
                    <td className="py-0.5 pr-3">{c.startDate}</td>
                    <td className="py-0.5 pr-3">{c.lengthDays ?? "latest"}{c.outsideUsualRange ? " *" : ""}</td>
                    <td className="py-0.5">{c.durationDays ?? "not recorded"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section aria-labelledby="cpr-flow">
          <h3 id="cpr-flow" className="font-semibold">Flow</h3>
          <p>
            {report.flow.loggedDays} days with a flow level logged; {report.flow.heavyOrFloodingDays} heavy or flooding, {report.flow.spottingDays} spotting.
          </p>
        </section>

        <section aria-labelledby="cpr-symptoms">
          <h3 id="cpr-symptoms" className="font-semibold">Symptoms and mood</h3>
          {report.symptoms.length === 0 && report.moods.length === 0 ? (
            <p>None logged in this window.</p>
          ) : (
            <p>
              {[...report.symptoms, ...report.moods]
                .slice(0, 10)
                .map((s) => `${s.name.replace(/_/g, " ")} ${s.days} of ${report.loggedDays} days (${s.percentOfLoggedDays}%)`)
                .join("; ")}
              .
            </p>
          )}
        </section>

        <section aria-labelledby="cpr-meno">
          <h3 id="cpr-meno" className="font-semibold">Menopause log</h3>
          {menopause.length === 0 ? (
            <p>No entries in this window.</p>
          ) : (
            <ul className="list-disc space-y-0.5 pl-5">
              {menopause.map((m) => (
                <li key={`${m.loggedAt}-${m.symptoms.join()}`} className={m.bleeding ? "font-medium text-red-800 dark:text-red-300" : undefined}>
                  {m.loggedAt}: {m.symptoms.map((s) => MENOPAUSE_SYMPTOM_LABEL[s as MenopauseSymptomType] ?? s).join(", ") || "no symptoms ticked"}
                  {m.severity !== null ? `, severity ${m.severity} of 10` : ""}
                  {m.bleeding ? ", bleeding after menopause reported" : ""}
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{report.statement}</p>
      </CardContent>
    </Card>
  );
}
