import {
  checkbackConfigSchema,
  describeTableSchema,
  explainerConfigSchema,
  safetyNetConfigSchema,
} from "@tarragon/symptom-triage-engine";
import { signSymptomUxConfigAction } from "../clinical-signoff/symptom-ux-actions";
import type { SymptomUxKind, SymptomUxWaiting } from "@/lib/queries/pending-symptom-ux-signoff";

/**
 * Sign the symptom checker's assessment-experience wording and timing (S59c). Shown inline on the sign-off hub, one form per waiting item.
 * Everything shown is read from the draft being signed, in full, so the words the CMO signs are the values that will apply. Each of these
 * is an UNSIGNED DRAFT written by an agent from the signed v1 rules; none has been reviewed by a clinician.
 */
const TITLES: Record<SymptomUxKind, string> = {
  checkback: "Follow-up after a symptom check (timing)",
  describe: "Describe-it words (how a person's own words are routed to a check)",
  explainer: "Why this result (the reasons shown beside a result)",
  safety_net: "Safety-net lines (go to a hospital or call for help straight away if)",
};

const WHAT_SIGNING_DOES: Record<SymptomUxKind, string> = {
  checkback: "Once signed, and once the symptom checker is open, a self-care or routine result is followed up and the patient is asked whether it is better, the same or worse.",
  describe: "Once signed, a person's own words can suggest one of the signed checks (the person always confirms, and the danger-phrase screen runs first). Until then the words are screened for danger and nothing is suggested.",
  explainer: "Once signed, a result shows the reason for each rule that fired, with the person's own answers beside it. Until then no explanation is shown.",
  safety_net: "Once signed, the lines below are added to the generic safety net on a result. The emergency number is shown only if you also confirm it. Until then only the generic safety net is shown.",
};

const SCHEMAS = { checkback: checkbackConfigSchema, describe: describeTableSchema, explainer: explainerConfigSchema, safety_net: safetyNetConfigSchema } as const;

function Body({ kind, rules }: { kind: SymptomUxKind; rules: unknown }) {
  if (kind === "checkback") {
    const p = checkbackConfigSchema.safeParse(rules);
    if (!p.success) return null;
    const c = p.data;
    return (
      <ul className="list-disc space-y-1 pl-5 text-sm text-charcoal-ink/80">
        <li>Self-care result: asked {c.categories.self_management.delay_hours} hours later. A &quot;same&quot; answer points to a booking from {c.categories.self_management.same_nudge_after_hours} hours after the check.</li>
        <li>Routine result: asked {c.categories.routine.delay_hours} hours later. A &quot;same&quot; answer points to a booking from {c.categories.routine.same_nudge_after_hours} hours after the check.</li>
        <li>Urgent and emergency results are never followed up this way (a human is already involved).</li>
        <li>
          Open for {c.expire_after_hours} hours (a late answer is still taken). {c.max_nudges} reminder, {c.nudge_after_hours} hours after it opens. Notices go between {c.notification_window.start_hour}:00 and {c.notification_window.end_hour}:00 Lagos time.
        </li>
        <li>&quot;Worse&quot;, or any newly ticked warning sign, raises one clinician alert carrying the original summary. A warning sign that fires an emergency rule opens the emergency path.</li>
      </ul>
    );
  }
  if (kind === "describe") {
    const p = describeTableSchema.safeParse(rules);
    if (!p.success) return null;
    return (
      <div className="space-y-1 text-sm text-charcoal-ink/80">
        <p>
          A check is suggested when its score is at least {p.data.min_score}, and only if it leads the next by at least {p.data.ambiguity_margin}; otherwise the person is asked to choose. English and common Nigerian English only; no Pidgin.
        </p>
        {p.data.entries.map((e) => (
          <p key={e.id}>
            <span className="font-medium text-charcoal-ink">{e.pathway_key} (weight {e.weight}):</span> {e.phrases.join(", ")}
          </p>
        ))}
      </div>
    );
  }
  if (kind === "explainer") {
    const p = explainerConfigSchema.safeParse(rules);
    if (!p.success) return null;
    return (
      <ul className="list-disc space-y-1 pl-5 text-sm text-charcoal-ink/80">
        {p.data.entries.map((e) => (
          <li key={e.id}>
            <span className="font-medium text-charcoal-ink">{e.id}:</span> {e.reason}
            {e.tell_us_sooner_if && e.tell_us_sooner_if.length > 0 ? <span> (tell your care team sooner if: {e.tell_us_sooner_if.join("; ")})</span> : null}
          </li>
        ))}
      </ul>
    );
  }
  const p = safetyNetConfigSchema.safeParse(rules);
  if (!p.success) return null;
  return (
    <div className="space-y-1 text-sm text-charcoal-ink/80">
      <p>
        National emergency number in this draft: {p.data.emergency_number ? `${p.data.emergency_number.value}, ${p.data.emergency_number.confirmed ? "confirmed" : "NOT confirmed, so it is not shown to patients"}` : "none"}. No helpline number is included.
      </p>
      {p.data.entries.map((e) => (
        <div key={e.id}>
          <p className="font-medium text-charcoal-ink">
            {e.pathway_key === "*" ? "Every check" : e.pathway_key}, {e.category === "*" ? "every result" : `${e.category} result`}:
          </p>
          <ul className="list-disc pl-5">
            {e.triggers.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function SymptomUxPanel({ waiting }: { waiting: SymptomUxWaiting[] }) {
  if (waiting.length === 0) return null;
  const btn = "rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";
  return (
    <div className="space-y-6">
      {waiting.map((w) => {
        const readable = SCHEMAS[w.kind].safeParse(w.rules).success;
        const body = <Body kind={w.kind} rules={w.rules} />;
        return (
          <form key={w.kind} action={signSymptomUxConfigAction} className="space-y-3">
            <input type="hidden" name="kind" value={w.kind} />
            <input type="hidden" name="version" value={w.version} />
            <h3 className="font-medium text-charcoal-ink">
              {TITLES[w.kind]}, version {w.version}
            </h3>
            <p className="text-sm text-charcoal-ink/80">{WHAT_SIGNING_DOES[w.kind]}</p>
            {readable ? body : <p className="text-sm text-charcoal-ink/80">This draft could not be read, so it is not shown here. Do not sign until it can be.</p>}
            <label className="flex items-start gap-2 text-sm text-charcoal-ink">
              <input type="checkbox" name="understood" className="mt-1" required disabled={!readable} />
              <span>I have read all of the above and I sign {TITLES[w.kind].toLowerCase()} version {w.version} for use. The symptom checker itself stays behind its own go-live guard.</span>
            </label>
            <button type="submit" className={btn} disabled={!readable}>
              Sign version {w.version}
            </button>
          </form>
        );
      })}
    </div>
  );
}
