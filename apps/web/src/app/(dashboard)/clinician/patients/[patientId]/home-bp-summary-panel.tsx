import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { readPatientVitalsAudited } from "@/lib/clinical/vitals-audited";
import { readHomeBpProgramme } from "@/lib/home-bp/read-home-bp-programme";
import { addLocalDays, buildHomeBpClinicianSummary, type HomeBpReading } from "@tarragon/clinical";
import { t } from "@tarragon/i18n";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-NG", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const nowMs = () => Date.now();
const todayLagos = () => new Date(nowMs() + 3_600_000).toISOString().slice(0, 10);

/**
 * One-page home blood pressure summary for the care team (S70b item 5): the average, the range, the number of readings and how complete the seven days are.
 *
 * Readable only through the existing audited clinician read: the readings come from `read_patient_vitals_audited` (tie-gated, audited, INV-10 and INV-12), so
 * a clinician who is not tied to this patient sees "not available to you", never an empty summary. Only manual and device blood pressure counts (the same
 * rule the server's recount uses); a wearable estimate is never part of it. All numbers come from the signed home blood pressure programme configuration;
 * while it is unsigned the panel says so and shows nothing computed. It grades nothing and is never shown to the patient.
 */
export async function HomeBpSummaryPanel({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const programme = await readHomeBpProgramme(supabase);
  const cfg = programme.live?.config ?? null;

  let body: React.ReactNode;
  if (programme.loadFailed) {
    body = (
      <p role="alert" className="text-sm text-charcoal-ink/70">
        The home blood pressure settings could not be loaded just now. Do not assume there is no data.
      </p>
    );
  } else if (!cfg) {
    body = <p className="text-sm text-charcoal-ink/70">The home blood pressure programme has not been signed yet, so no summary is calculated.</p>;
  } else {
    const startDate = addLocalDays(todayLagos(), -(cfg.protocol.targetDays - 1));
    const sinceIso = new Date(Date.parse(`${startDate}T00:00:00Z`) - 3_600_000).toISOString();
    const result = await readPatientVitalsAudited(supabase, patientId, { vitalType: "blood_pressure", since: sinceIso, limit: 500, ascending: true });
    if (result.status === "denied") {
      body = <p className="text-sm text-charcoal-ink/70">Not available to you. You need a care relationship with this patient to read their readings.</p>;
    } else if (result.status === "error") {
      body = (
        <p role="alert" className="text-sm text-charcoal-ink/70">
          The readings could not be loaded just now. Do not assume there are none.
        </p>
      );
    } else {
      const readings: HomeBpReading[] = result.rows
        .filter((r) => (r.source === "manual" || r.source === "device") && r.systolic !== null && r.diastolic !== null)
        .map((r) => ({ systolic: r.systolic as number, diastolic: r.diastolic as number, atMs: Date.parse(r.taken_at) }));
      const s = buildHomeBpClinicianSummary(readings, startDate, nowMs(), cfg);
      body = (
        <div className="space-y-3" data-testid="home-bp-summary">
          <p className="text-xs text-charcoal-ink/60">
            {day(s.windowStart)} to {day(s.windowEnd)}. Settings version {s.configVersion}.
          </p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-charcoal-ink/60">{t("hbp.summary.average")}</dt>
              <dd className="font-medium">{s.average ? `${s.average.systolic}/${s.average.diastolic} mmHg` : "Not enough readings yet"}</dd>
            </div>
            <div>
              <dt className="text-charcoal-ink/60">{t("hbp.summary.range")}</dt>
              <dd className="font-medium">
                {s.range ? `${s.range.systolic.min} to ${s.range.systolic.max} / ${s.range.diastolic.min} to ${s.range.diastolic.max}` : "None"}
              </dd>
            </div>
            <div>
              <dt className="text-charcoal-ink/60">{t("hbp.summary.count")}</dt>
              <dd className="font-medium">
                {s.readings} over {s.days} {s.days === 1 ? "day" : "days"}
              </dd>
            </div>
            <div>
              <dt className="text-charcoal-ink/60">{t("hbp.summary.completeness")}</dt>
              <dd className="font-medium">
                {s.sessionsDone} of {s.sessionsExpected} sessions{" "}
                <Badge variant={s.complete ? "green" : "grey"}>{s.complete ? t("hbp.summary.complete") : t("hbp.summary.incomplete")}</Badge>
              </dd>
            </div>
          </dl>
          <p className="text-xs text-charcoal-ink/60">
            Needs at least {s.minReadings} readings over {s.minDays} days for an average. Wearable estimates and readings less than a minute apart are not counted.
          </p>
        </div>
      );
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("hbp.summary.title")}</CardTitle>
        <CardDescription>The last seven days of the patient&apos;s own cuff readings. For the care team only. Opening it is recorded in the access log.</CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
