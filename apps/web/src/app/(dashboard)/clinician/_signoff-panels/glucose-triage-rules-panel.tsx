import { GLUCOSE_WORDING_CODES, GLUCOSE_WORDING_DATA, GLUCOSE_WORDING_SIGNED } from "@tarragon/i18n";
import { GLUCOSE_CARE_V1 } from "@tarragon/clinical";
import { GLUCOSE_CITATIONS, GLUCOSE_OPEN_POINTS, GLUCOSE_RULE_BASIS, GLUCOSE_SIGNING_NOTE } from "@/lib/clinical/glucose-triage-basis";
import { createClient } from "@/lib/supabase/server";
import { rulesMatchBuild } from "@/lib/clinical/glucose-triage-basis";
import { TriageRulesPanel } from "./triage-rules-panel";

type Reader = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): { order(column: string, o: { ascending: boolean }): PromiseLike<{ data: unknown; error: { message: string } | null }> };
    };
  };
};

/**
 * Glucose triage rules (plan item R2, CMO decisions Q6 to Q9) for the Chief Medical Officer: the numbers, the guideline basis of every rule with its
 * citations, the patient wording in full (the draft that is NOT in force, beside what is shown today), and then the same rule list and Sign control
 * the blood pressure rules use. The words and the numbers are read from the code that the app bundles and the migration seeds, which a test keeps
 * identical, so what is read here is what would be signed. Nothing on this panel signs anything; the Sign control below it is the CMO's act.
 */
export async function GlucoseTriageRulesPanel({ back }: { back?: "hub" }) {
  // The text below is this build's copy of version 1. It is shown only while the draft that the Sign control targets is exactly that copy.
  const supabase = (await createClient()) as unknown as Reader;
  const res = await supabase.from("triage_rule_sets").select("version, rules").eq("code", "glucose_care_triage").order("version", { ascending: false });
  const latest = res.error || !Array.isArray(res.data) ? null : ((res.data as Array<{ version: number; rules: unknown }>)[0] ?? null);
  const sameAsBuild = latest !== null && rulesMatchBuild(latest.rules);
  const p = GLUCOSE_CARE_V1.params;
  const numbers: Array<[string, string]> = [
    ["Red: glucose under", `${p.hypo.severe.toFixed(1)} mmol/L (ADA level 2)`],
    ["Treat now with fast sugar: glucose from", `${p.hypo.severe.toFixed(1)} up to ${p.hypo.alert.toFixed(1)} mmol/L (ADA level 1)`],
    ["Red: suspected DKA at glucose", `${p.high.dka.toFixed(1)} mmol/L or more with blood ketones ${p.ketone.dka.toFixed(1)} or more, or urine ketones moderate or large`],
    ["Raised ketones from", `${p.ketone.raised.toFixed(1)} mmol/L (red with vomiting, stomach pain, fast breathing or drowsiness; otherwise urgent same-day review)`],
    ["Urgent same-day review: glucose", `${p.high.urgent.toFixed(1)} mmol/L or more (red with vomiting, drowsiness, confusion or very thirsty and not keeping fluids down)`],
    ["Red whatever else is known: glucose", `${p.high.severe.toFixed(1)} mmol/L or more`],
    ["Who is graded", `adults ${p.minAdultAgeYears} and over with type 1 or type 2 diabetes (or none recorded). Pregnancy, under ${p.minAdultAgeYears} and other types go to a clinician. The severe low and suspected DKA reds apply to everyone.`],
  ];
  if (!sameAsBuild) {
    return (
      <div className="space-y-6">
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{GLUCOSE_SIGNING_NOTE}</p>
        <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          {latest === null
            ? "The glucose rule set could not be read just now, so the guideline basis and the patient wording are not shown. Do not sign what you cannot read. Nothing has been changed."
            : `The rule set waiting for you is version ${latest.version}, which differs from the text this page was built with (version ${GLUCOSE_CARE_V1.version}). The guideline basis and wording are therefore not shown: they would describe different rules. Read the rule list below, and do not sign until the basis for this version has been written.`}
        </p>
        <TriageRulesPanel code="glucose_care_triage" page="glucose" {...(back ? { back } : {})} />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{GLUCOSE_SIGNING_NOTE}</p>

      <section aria-labelledby="gl-open-h" className="space-y-2">
        <h2 id="gl-open-h" className="font-heading text-base font-semibold text-charcoal-ink">Before you sign: points for your judgement</h2>
        <ul className="grid gap-2">
          {GLUCOSE_OPEN_POINTS.map((p) => (
            <li key={p.slice(0, 40)} className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{p}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="gl-numbers-h" className="space-y-2">
        <h2 id="gl-numbers-h" className="font-heading text-base font-semibold text-charcoal-ink">The numbers</h2>
        <dl className="grid gap-2 sm:grid-cols-2">
          {numbers.map(([k, v]) => (
            <div key={k} className="rounded-lg border border-charcoal-ink/10 bg-white p-3 text-sm dark:border-night-ink/15 dark:bg-night-card">
              <dt className="text-xs text-charcoal-ink/60">{k}</dt>
              <dd className="text-charcoal-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="gl-basis-h" className="space-y-2">
        <h2 id="gl-basis-h" className="font-heading text-base font-semibold text-charcoal-ink">Guideline basis, rule by rule</h2>
        <ul className="grid gap-2">
          {GLUCOSE_CARE_V1.rules.map((r) => {
            const b = GLUCOSE_RULE_BASIS[r.id];
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
          {GLUCOSE_CITATIONS.map((c) => (
            <li key={c.id}>
              <span className="font-mono">{c.id}</span> [{c.tag}] {c.label}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="gl-wording-h" className="space-y-2">
        <h2 id="gl-wording-h" className="font-heading text-base font-semibold text-charcoal-ink">What the patient is told</h2>
        <p className="text-sm text-charcoal-ink/70">
          {GLUCOSE_WORDING_SIGNED
            ? `Wording signed by ${GLUCOSE_WORDING_SIGNED.by} on ${GLUCOSE_WORDING_SIGNED.on}.`
            : "The wording is NOT signed. Today the plain text is shown; the proposed text, including the fast-sugar treatment message, is not in force until you sign it. Signing the wording is a separate act from signing the rules."}
        </p>
        <ul className="grid gap-2">
          {GLUCOSE_WORDING_CODES.map((code) => {
            const w = GLUCOSE_WORDING_DATA.codes[code];
            return (
              <li key={code} className="rounded-lg border border-charcoal-ink/10 bg-white p-3 text-sm dark:border-night-ink/15 dark:bg-night-card">
                <p className="font-mono text-xs text-charcoal-ink/60">{code}</p>
                <p className="text-charcoal-ink"><span className="font-semibold">Shown today:</span> {w.current.title}. {w.current.body}</p>
                <p className="mt-1 text-charcoal-ink"><span className="font-semibold">Proposed:</span> {w.proposed.title}. {w.proposed.body}</p>
              </li>
            );
          })}
        </ul>
      </section>

      <TriageRulesPanel code="glucose_care_triage" page="glucose" {...(back ? { back } : {})} />
    </div>
  );
}
