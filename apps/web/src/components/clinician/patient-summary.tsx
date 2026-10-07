import { t, type Locale } from "@tarragon/i18n";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PatientSummary } from "@/lib/clinician/queue-console";

const dateTime = (value: string): string =>
  new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" });
const day = (value: string): string => new Date(value).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "Africa/Lagos" });

function readingText(r: NonNullable<PatientSummary["readings"]>["rows"][number]): string {
  if (r.systolic !== null && r.diastolic !== null) return `${r.systolic}/${r.diastolic} ${r.unit ?? "mmHg"}`;
  return `${r.value_numeric ?? "?"} ${r.unit ?? ""}`.trim();
}

/** Target ranges are free-form JSON on the care plan; show a flat "key min-max" line and never guess at structure. */
function targetText(target: unknown): string {
  if (!target || typeof target !== "object") return "";
  return Object.entries(target as Record<string, unknown>)
    .map(([k, v]) => `${k.replace(/_/g, " ")} ${typeof v === "object" && v !== null ? Object.values(v as Record<string, unknown>).join("-") : String(v)}`)
    .join("; ");
}

/**
 * The patient summary (spec 9.2) as one read-only view over `clinician_patient_summary`. A section the clinician may
 * not read is simply absent; the function names what it left out in `denied` and we say so once. No result values are
 * shown, only release state (INV-03, INV-04); the care circle is a count, not names.
 */
export function PatientSummaryView({ summary, locale = "en" }: { summary: PatientSummary; locale?: Locale }) {
  const s = summary;
  return (
    <section aria-labelledby="summary-title" className="space-y-4">
      <div>
        <h2 id="summary-title" className="font-heading text-lg font-semibold text-charcoal-ink">
          {t("summary.title", locale)}
          {s.patient_first_name ? `: ${s.patient_first_name}` : ""}
        </h2>
        <p className="text-xs text-charcoal-ink/60">{t("summary.opened_note", locale)}</p>
        {s.status === "partial" && <p className="text-xs text-amber-700">{t("summary.partial", locale)}</p>}
      </div>

      {(s.allergies || s.conditions) && (
        <Card>
          <CardContent className="grid gap-4 pt-4 text-sm sm:grid-cols-2">
            {s.allergies && (
              <div>
                <p className="font-medium">{t("summary.allergies", locale)}</p>
                <ul>{s.allergies.map((a, i) => <li key={i}>{a.allergen}{a.reaction ? `: ${a.reaction}` : ""}{a.severity ? ` (${a.severity})` : ""}</li>)}</ul>
              </div>
            )}
            {s.conditions && (
              <div>
                <p className="font-medium">{t("summary.conditions", locale)}</p>
                <ul>{s.conditions.map((c, i) => <li key={i}>{c.condition_name} ({c.status})</li>)}</ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {s.triage_events && (
        <Card>
          <CardHeader><CardTitle>{t("summary.triage", locale)}</CardTitle></CardHeader>
          <CardContent>
            {s.triage_events.length === 0 ? (
              <p className="text-sm text-charcoal-ink/60">{t("summary.none_recent", locale)}</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {s.triage_events.map((e, i) => (
                  <li key={`${e.created_at}-${i}`} className="flex items-center gap-2">
                    <Badge variant={e.grade === "red" ? "red" : e.grade === "amber" ? "amber" : "green"}>{e.grade}</Badge>
                    <span>{e.trigger_type.replace(/_/g, " ")}</span>
                    <span className="ml-auto text-xs text-charcoal-ink/60">{dateTime(e.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {s.symptom_summaries && s.symptom_summaries.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("symptom.summary.clinician.title", locale)}</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-xs text-charcoal-ink/60">{t("symptom.summary.clinician.sent_by_choice", locale)}</p>
            {s.symptom_summaries.map((x) => (
              <div key={x.id} className="space-y-1">
                <p className="font-medium">
                  {x.payload.complaint_label} <Badge variant={x.payload.category === "emergency" ? "red" : x.payload.category === "urgent" ? "amber" : "green"}>{x.payload.category.replace(/_/g, " ")}</Badge>
                  <span className="ml-2 text-xs text-charcoal-ink/60">{dateTime(x.sent_at)}</span>
                </p>
                {x.payload.answered_by_carer && <p className="text-xs">{t("symptom.summary.clinician.carer", locale)}</p>}
                <p>{[x.payload.onset, typeof x.payload.severity === "number" ? `${x.payload.severity}/10` : null, ...(x.payload.associated_symptoms ?? []), ...(x.payload.history ?? [])].filter(Boolean).map((v) => String(v).replace(/_/g, " ")).join(", ")}</p>
                {(x.payload.questions ?? []).length > 0 && (
                  <ul className="list-disc pl-4 text-charcoal-ink/80">
                    {(x.payload.questions ?? []).map((q, i) => <li key={i}>{q.prompt}: {q.answer === true ? "yes" : q.answer === false ? "no" : String(q.answer ?? "")}</li>)}
                  </ul>
                )}
                {(x.payload.red_flags_fired ?? []).length > 0 && <p className="text-red-800">{(x.payload.red_flags_fired ?? []).join("; ")}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {s.readings && (
        <Card>
          <CardHeader><CardTitle>{t("summary.readings", locale)}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {s.readings.targets.map((tg) => (
              <p key={tg.condition} className="text-xs text-charcoal-ink/60">
                {tg.condition.replace(/_/g, " ")}: {t("summary.target", locale, { target: targetText(tg.target_ranges) || "-" })}
              </p>
            ))}
            {s.readings.rows.length === 0 ? (
              <p className="text-sm text-charcoal-ink/60">{t("summary.no_readings", locale)}</p>
            ) : (
              <ul className="divide-y divide-charcoal-ink/10 text-sm">
                {s.readings.rows.slice(0, 30).map((r, i) => (
                  <li key={`${r.measured_at}-${i}`} className="flex justify-between py-1">
                    <span>{r.type.replace(/_/g, " ")} {readingText(r)}</span>
                    <span className="text-xs text-charcoal-ink/60">{dateTime(r.measured_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {s.medications && (
        <Card>
          <CardHeader><CardTitle>{t("summary.medicines", locale)}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <ul>
              {s.medications.active.map((m) => (
                <li key={m.id}>{m.drug_name} {m.dose ?? ""} {m.frequency ?? ""}</li>
              ))}
            </ul>
            <p className="text-charcoal-ink/70">
              {typeof s.medications.adherence.percent === "number"
                ? t("summary.adherence", locale, { percent: s.medications.adherence.percent })
                : t("summary.adherence_unknown", locale)}
            </p>
          </CardContent>
        </Card>
      )}

      {s.care_plan && s.care_plan.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("summary.care_plan", locale)}</CardTitle></CardHeader>
          <CardContent className="text-sm">
            <ul>{s.care_plan.map((c) => <li key={c.id}>{c.condition.replace(/_/g, " ")} ({c.status})</li>)}</ul>
          </CardContent>
        </Card>
      )}

      {s.pending_proposals && s.pending_proposals.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("summary.pending", locale)}</CardTitle></CardHeader>
          <CardContent className="text-sm">
            <ul>{s.pending_proposals.map((p) => <li key={p.id}>{p.kind.replace(/_/g, " ")}: {p.state} ({day(p.created_at)})</li>)}</ul>
          </CardContent>
        </Card>
      )}

      {s.signed_notes && s.signed_notes.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("summary.notes", locale)}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {s.signed_notes.map((n) => (
              <div key={n.id}>
                <p className="text-xs text-charcoal-ink/60">{n.finalized_at ? day(n.finalized_at) : ""} {n.encounter_type ?? ""}</p>
                {n.assessment && <p>{n.assessment}</p>}
                {n.plan && <p className="text-charcoal-ink/70">{n.plan}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {s.results && s.results.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("summary.results", locale)}</CardTitle></CardHeader>
          <CardContent className="text-sm">
            <ul>
              {s.results.map((r) => (
                <li key={r.id}>{t("summary.result_line", locale, { panel: r.panel_code ?? "-", state: r.release_state.replace(/_/g, " ") })} ({day(r.received_at)})</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {s.care_circle && (
        <p className="text-sm text-charcoal-ink/70">{t("summary.circle_count", locale, { count: s.care_circle.active_members })}</p>
      )}
    </section>
  );
}
