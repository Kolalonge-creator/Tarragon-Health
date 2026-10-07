import { t, type MessageKey } from "@tarragon/i18n";
import { getProposedConfig } from "@tarragon/shared";
import { riskTighteningConfigSchema } from "@tarragon/symptom-triage-engine";
import { createClient } from "@/lib/supabase/server";
import { degradedModeConfig } from "@/lib/symptom-triage/safe-run";
import { recordPositionAction, runAuditAction } from "@/lib/symptom-triage/safety-actions";

type Cell = {
  dimension: string;
  group: string;
  suppressed: boolean;
  n?: number;
  matched?: number;
  under?: number;
  over?: number;
  match_rate?: number;
  match_low?: number;
  match_high?: number;
  under_rate?: number;
  under_low?: number;
  under_high?: number;
  over_rate?: number;
};
type Report = { id: string; period_start: string; is_baseline: boolean; includes_test_accounts: boolean; reviewed_total: number; cells: Cell[]; config_version: number };
type Position = { classification: string; counsel_name: string; position_date: string; attached_by: string };

const card = "space-y-3 rounded-xl border border-charcoal-ink/10 bg-white p-4 shadow-sm dark:border-night-ink/15 dark:bg-night-card";
const field = "mt-1 block w-full rounded-lg border border-charcoal-ink/20 px-3 py-2 text-sm";
const pct = (x?: number) => (x == null ? "-" : `${Math.round(x * 100)}%`);
const OUTCOME: Record<string, { ok: boolean; key: MessageKey }> = {
  position_done: { ok: true, key: "symptom.safety.position.done" },
  position_error: { ok: false, key: "symptom.safety.position.error" },
  position_input: { ok: false, key: "symptom.safety.position.error" },
  audit_done: { ok: true, key: "symptom.safety.audit.done" },
  audit_error: { ok: false, key: "symptom.safety.audit.error" },
};

/**
 * S60: the symptom checker safety page, for an admin and for the CMO (the CMO's account role cannot open /admin, so the same page
 * is mounted under /clinician). It shows the go-live guard state (it never switches it), the stated review time, the recorded
 * regulatory position with the form to record one, the monthly accuracy audit (aggregate, internal, never publishable), the
 * prevalence layer and what happens when the engine fails. Reads are through RLS policies that admit only an admin or the CMO.
 */
export async function SymptomSafetyPage({ viewer, outcome }: { viewer: "admin" | "cmo"; outcome?: string }) {
  const supabase = await createClient();
  const [status, stated, positions, reports] = await Promise.all([
    supabase.rpc("go_live_guard_is_open", { p_key: "symptom_checker_enabled" }),
    supabase.rpc("symptom_review_stated_time"),
    supabase.from("regulatory_positions").select("classification, counsel_name, position_date, attached_by").eq("topic", "symptom_checker").order("attached_at", { ascending: false }).limit(1),
    supabase.from("symptom_accuracy_reports").select("id, period_start, is_baseline, includes_test_accounts, reviewed_total, cells, config_version").order("period_start", { ascending: false }).limit(6),
  ]);
  const guardOn = status.data === true;
  const time = (stated.data ?? null) as { stated?: boolean; minutes?: number; sla_version?: number } | null;
  const position = ((positions.data ?? [])[0] ?? null) as Position | null;
  const reportRows = (reports.data ?? []) as unknown as Report[];
  const risk = riskTighteningConfigSchema.safeParse(getProposedConfig("symptom.risk_tightening").value);
  const degraded = degradedModeConfig();
  let attachedBy = "-";
  if (position) {
    const { data } = await supabase.from("profiles").select("full_name").eq("id", position.attached_by).maybeSingle();
    attachedBy = data?.full_name ?? "-";
  }
  const flash = outcome ? OUTCOME[outcome] : undefined;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <header className="space-y-1">
        <h1 className="font-heading text-xl font-semibold text-charcoal-ink">{t("symptom.safety.title")}</h1>
        <p className="text-sm text-charcoal-ink/70">{t("symptom.safety.intro")}</p>
      </header>
      {flash && (
        <p role={flash.ok ? "status" : "alert"} className={`rounded-lg px-3 py-2 text-sm ${flash.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`}>
          {t(flash.key)}
        </p>
      )}

      <section className={card}>
        <h2 className="font-heading text-base font-semibold text-charcoal-ink">{t("symptom.safety.guard")}</h2>
        <p className="text-sm">{guardOn ? t("symptom.safety.guard_on") : t("symptom.safety.guard_off")}</p>
        <h3 className="pt-1 text-sm font-semibold text-charcoal-ink">{t("symptom.safety.review_time")}</h3>
        <p className="text-sm">
          {time?.stated && typeof time.minutes === "number"
            ? t("symptom.safety.review_time_value", "en", { minutes: time.minutes, version: time.sla_version ?? "-" })
            : t("symptom.safety.review_time_none")}
        </p>
      </section>

      <section className={card}>
        <h2 className="font-heading text-base font-semibold text-charcoal-ink">{t("symptom.safety.position.title")}</h2>
        <p className="text-sm">
          {position
            ? t("symptom.safety.position.latest", "en", {
                classification: t(`symptom.safety.class.${position.classification}` as MessageKey),
                counsel: position.counsel_name,
                date: position.position_date,
                by: attachedBy,
              })
            : t("symptom.safety.position.none")}
        </p>
        <form action={recordPositionAction} className="space-y-2 border-t border-charcoal-ink/10 pt-3">
          <h3 className="text-sm font-semibold text-charcoal-ink">{t("symptom.safety.position.form")}</h3>
          <input type="hidden" name="viewer" value={viewer} />
          <label className="block text-sm">{t("symptom.safety.position.text")}<textarea name="text" required minLength={40} maxLength={4000} rows={4} className={field} /></label>
          <label className="block text-sm">
            {t("symptom.safety.position.classification")}
            <select name="classification" required defaultValue="not_yet_determined" className={field}>
              {(["decision_support_not_a_device", "regulated_medical_device_registered", "regulated_medical_device_not_registered", "not_yet_determined"] as const).map((c) => (
                <option key={c} value={c}>{t(`symptom.safety.class.${c}` as MessageKey)}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">{t("symptom.safety.position.counsel")}<input name="counsel" required minLength={3} maxLength={200} className={field} /></label>
          <label className="block text-sm">{t("symptom.safety.position.firm")}<input name="firm" maxLength={200} className={field} /></label>
          <label className="block text-sm">{t("symptom.safety.position.date")}<input name="date" type="date" required max={today} className={field} /></label>
          <label className="block text-sm">{t("symptom.safety.position.document")}<input name="document" maxLength={300} className={field} /></label>
          <button type="submit" className="rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white">{t("symptom.safety.position.submit")}</button>
        </form>
      </section>

      <section className={card}>
        <h2 className="font-heading text-base font-semibold text-charcoal-ink">{t("symptom.safety.audit.title")}</h2>
        <p className="text-sm text-charcoal-ink/70">{t("symptom.safety.audit.note")}</p>
        {reportRows.length === 0 && <p className="text-sm">{t("symptom.safety.audit.none")}</p>}
        {reportRows.map((r) => (
          <div key={r.id} className="space-y-1 rounded-lg bg-charcoal-ink/5 p-3 text-sm">
            <p className="font-medium">
              {r.period_start.slice(0, 7)} · {t("symptom.safety.audit.reviewed", "en", { n: r.reviewed_total })}
              {r.is_baseline ? ` · ${t("symptom.safety.audit.baseline")}` : ""}
              {r.includes_test_accounts ? ` · ${t("symptom.safety.audit.test_marked")}` : ""}
            </p>
            <ul className="space-y-0.5 text-xs">
              {r.cells.map((c) => (
                <li key={`${c.dimension}:${c.group}`}>
                  {c.dimension} / {c.group}:{" "}
                  {c.suppressed
                    ? t("symptom.safety.audit.suppressed")
                    : `n ${c.n}; ${t("symptom.safety.audit.matched")} ${pct(c.match_rate)} (${pct(c.match_low)} to ${pct(c.match_high)}); ${t("symptom.safety.audit.under")} ${pct(c.under_rate)} (${pct(c.under_low)} to ${pct(c.under_high)}); ${t("symptom.safety.audit.over")} ${pct(c.over_rate)}`}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <form action={runAuditAction} className="space-y-2 border-t border-charcoal-ink/10 pt-3">
          <h3 className="text-sm font-semibold text-charcoal-ink">{t("symptom.safety.audit.run")}</h3>
          <input type="hidden" name="viewer" value={viewer} />
          <label className="block text-sm">{t("symptom.safety.audit.month")}<input name="month" type="date" required className={field} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="include_test" /> {t("symptom.safety.audit.include_test")}</label>
          <button type="submit" className="rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white">{t("symptom.safety.audit.submit")}</button>
        </form>
      </section>

      <section className={card}>
        <h2 className="font-heading text-base font-semibold text-charcoal-ink">{t("symptom.safety.risk.title")}</h2>
        <p className="text-sm text-charcoal-ink/70">{t("symptom.safety.risk.note")}</p>
        {risk.success && risk.data.entries.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {risk.data.entries.map((e) => (
              <li key={e.id}>
                {e.label} · {e.status === "signed_off" && e.clinical_sign_off ? t("symptom.safety.risk.signed") : t("symptom.safety.risk.draft")}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm">{t("symptom.safety.risk.none")}</p>
        )}
      </section>

      <section className={card}>
        <h2 className="font-heading text-base font-semibold text-charcoal-ink">{t("symptom.safety.degraded.title")}</h2>
        <p className="text-sm">
          {t("symptom.safety.degraded.body", "en", { category: degraded.unclassifiable_category, ignore: degraded.ignore_severity_floors ? "yes" : "no" })}
        </p>
      </section>
    </div>
  );
}
