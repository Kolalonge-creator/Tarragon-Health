import { VITALS_WORDING_CODES, VITALS_WORDING_DATA, VITALS_WORDING_SIGNED } from "@tarragon/i18n";
import { VITALS_CARE_V1 } from "@tarragon/clinical";
import { VITALS_CITATIONS, VITALS_OPEN_POINTS, VITALS_RULE_BASIS, VITALS_SIGNING_NOTE, rulesMatchBuild } from "@/lib/clinical/vitals-triage-basis";
import { createClient } from "@/lib/supabase/server";
import { TriageRulesPanel } from "./triage-rules-panel";

type Reader = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): { order(column: string, o: { ascending: boolean }): PromiseLike<{ data: unknown; error: { message: string } | null }> };
    };
  };
};

/**
 * Pulse, SpO2 and temperature triage rules for the Chief Medical Officer: the numbers, the guideline basis of every rule with its citations (including how each band
 * compares with NEWS2), the patient wording in full (the draft that is NOT in force, beside what is shown today), and then the same rule list and Sign control the
 * blood pressure rules use. The numbers and words are read from the code that the app bundles and the migration seeds, which a test keeps identical, so what is read
 * here is what would be signed. Nothing on this panel signs anything; the Sign control below it is the CMO's act.
 */
export async function VitalsTriageRulesPanel({ back }: { back?: "hub" }) {
  const supabase = (await createClient()) as unknown as Reader;
  const res = await supabase.from("triage_rule_sets").select("version, rules").eq("code", "vitals_care_triage").order("version", { ascending: false });
  const latest = res.error || !Array.isArray(res.data) ? null : ((res.data as Array<{ version: number; rules: unknown }>)[0] ?? null);
  const sameAsBuild = latest !== null && rulesMatchBuild(latest.rules);
  const p = VITALS_CARE_V1.params;
  const numbers: Array<[string, string]> = [
    ["Pulse: emergency (paged) at or below / at or above", `${p.pulse.emergencyAtOrBelow} / ${p.pulse.emergencyAtOrAbove} beats a minute, for everyone`],
    ["Pulse: same-day care (paged) in an adult", `${p.pulse.emergencyAtOrBelow + 1} to ${p.pulse.redAtOrBelow}, and ${p.pulse.redAtOrAbove} to ${p.pulse.emergencyAtOrAbove - 1}`],
    ["Pulse: review needed (a task)", `${p.pulse.redAtOrBelow + 1} to ${p.pulse.amberAtOrBelow}, and ${p.pulse.amberAtOrAbove} to ${p.pulse.redAtOrAbove - 1}. Under ${p.minAdultAgeYears}, anything outside ${p.pulse.amberAtOrBelow + 1} to ${p.pulse.amberAtOrAbove - 1} goes to a clinician instead of a page`],
    ["Oxygen saturation: emergency / same-day care / review", `under ${p.spo2.emergencyBelow}% / ${p.spo2.emergencyBelow}% to ${p.spo2.redAtOrBelow}% / ${p.spo2.redAtOrBelow + 1}% to ${p.spo2.amberAtOrBelow}%`],
    ["Temperature: emergency / same-day care / review", `${p.temperature.emergencyAtOrAbove.toFixed(1)} or above or under ${p.temperature.emergencyBelow.toFixed(1)} / ${p.temperature.redAtOrAbove.toFixed(1)} to ${(p.temperature.emergencyAtOrAbove - 0.1).toFixed(1)} / ${p.temperature.amberAtOrAbove.toFixed(1)} to ${(p.temperature.redAtOrAbove - 0.1).toFixed(1)} degrees`],
    ["Impossible values rejected as typos", `pulse ${p.validation.pulseMin} to ${p.validation.pulseMax}, oxygen ${p.validation.spo2Min}% to ${p.validation.spo2Max}%, temperature ${p.validation.temperatureMin} to ${p.validation.temperatureMax} degrees`],
  ];
  if (!sameAsBuild) {
    return (
      <div className="space-y-6">
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{VITALS_SIGNING_NOTE}</p>
        <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          {latest === null
            ? "The vitals rule set could not be read just now, so the guideline basis and the patient wording are not shown. Do not sign what you cannot read. Nothing has been changed."
            : `The rule set waiting for you is version ${latest.version}, which differs from the text this page was built with (version ${VITALS_CARE_V1.version}). The guideline basis and wording are therefore not shown: they would describe different rules. Read the rule list below, and do not sign until the basis for this version has been written.`}
        </p>
        <TriageRulesPanel code="vitals_care_triage" page="vitals" {...(back ? { back } : {})} />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{VITALS_SIGNING_NOTE}</p>

      <section aria-labelledby="vt-open-h" className="space-y-2">
        <h2 id="vt-open-h" className="font-heading text-base font-semibold text-charcoal-ink">Before you sign: points for your judgement</h2>
        <ul className="grid gap-2">
          {VITALS_OPEN_POINTS.map((t) => (
            <li key={t.slice(0, 40)} className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{t}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="vt-numbers-h" className="space-y-2">
        <h2 id="vt-numbers-h" className="font-heading text-base font-semibold text-charcoal-ink">The numbers</h2>
        <p className="text-sm text-charcoal-ink/70">These are the platform&apos;s older live bands, taken over unchanged as starting values so the two can be compared. They are proposed, not decided.</p>
        <dl className="grid gap-2 sm:grid-cols-2">
          {numbers.map(([k, v]) => (
            <div key={k} className="rounded-lg border border-charcoal-ink/10 bg-white p-3 text-sm dark:border-night-ink/15 dark:bg-night-card">
              <dt className="text-xs text-charcoal-ink/60">{k}</dt>
              <dd className="text-charcoal-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="vt-basis-h" className="space-y-2">
        <h2 id="vt-basis-h" className="font-heading text-base font-semibold text-charcoal-ink">Guideline basis, rule by rule</h2>
        <ul className="grid gap-2">
          {VITALS_CARE_V1.rules.map((r) => {
            const b = VITALS_RULE_BASIS[r.id];
            return (
              <li key={r.id} className="rounded-lg border border-charcoal-ink/10 bg-white p-3 text-sm dark:border-night-ink/15 dark:bg-night-card">
                <p className="font-mono text-xs text-charcoal-ink/60">{r.id}</p>
                <p className="text-charcoal-ink">{r.description}</p>
                {b ? (
                  <>
                    <p className="mt-1 text-charcoal-ink/80">{b.basis}</p>
                    {b.judgement ? <p className="mt-1 text-xs font-medium text-amber-900">For your judgement: {b.judgement}</p> : null}
                    <p className="mt-1 text-xs text-charcoal-ink/60">Sources: {b.citations.join(", ")}</p>
                  </>
                ) : (
                  <p className="mt-1 text-xs text-red-800">No guideline basis is recorded for this rule. Do not sign without one.</p>
                )}
              </li>
            );
          })}
        </ul>
        <ul className="mt-2 grid gap-1 text-xs text-charcoal-ink/70">
          {VITALS_CITATIONS.map((c) => (
            <li key={c.id}>
              <span className="font-mono">{c.id}</span> [{c.tag}] {c.label}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="vt-wording-h" className="space-y-2">
        <h2 id="vt-wording-h" className="font-heading text-base font-semibold text-charcoal-ink">What the patient is told</h2>
        <p className="text-sm text-charcoal-ink/70">
          {VITALS_WORDING_SIGNED
            ? `Wording signed by ${VITALS_WORDING_SIGNED.by} on ${VITALS_WORDING_SIGNED.on}.`
            : "The wording is NOT signed. Today the plain text would be used; the proposed text is not in force until you sign it. Signing the wording is a separate act from signing the rules."}
        </p>
        <ul className="grid gap-2">
          {VITALS_WORDING_CODES.map((code) => {
            const w = VITALS_WORDING_DATA.codes[code];
            return (
              <li key={code} className="rounded-lg border border-charcoal-ink/10 bg-white p-3 text-sm dark:border-night-ink/15 dark:bg-night-card">
                <p className="font-mono text-xs text-charcoal-ink/60">{code}</p>
                <p className="text-charcoal-ink"><span className="font-semibold">Plain text:</span> {w.current.title}. {w.current.body}</p>
                <p className="mt-1 text-charcoal-ink"><span className="font-semibold">Proposed:</span> {w.proposed.title}. {w.proposed.body}</p>
              </li>
            );
          })}
        </ul>
      </section>

      <TriageRulesPanel code="vitals_care_triage" page="vitals" {...(back ? { back } : {})} />
    </div>
  );
}
