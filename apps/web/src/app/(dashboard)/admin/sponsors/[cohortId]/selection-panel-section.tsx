import type { SupabaseClient } from "@supabase/supabase-js";
import {
  attributeLabel,
  isIttShown,
  MISSING_LABELS,
  panelAwaitingSignature,
  parseSelectionPanel,
  stageWithheldText,
  type SelectionComparison,
} from "@/lib/outcomes/cascade-report";

function Compare({ title, c }: { title: string; c: SelectionComparison }) {
  if ("withheld" in c) return <p>{title}: not shown.</p>;
  if (c.result.suppressed) return <p>{title}: {stageWithheldText(c.result.reason, c.result.minimum)}</p>;
  const res = c.result;
  return (
    <div className="space-y-2">
      <p className="font-medium">{title}</p>
      <p className="text-sm">A: {c.group_a_is} ({res.group_a_total}). B: {c.group_b_is} ({res.group_b_total}).{c.audience ? ` ${c.audience}.` : ""}</p>
      {res.attributes.map((a) => (
        <div key={a.attribute}>
          <p>{attributeLabel(a.attribute)}</p>
          <ul className="list-disc pl-5">
            {a.categories.map((k) => (
              <li key={k.category}>
                {k.category}: A {k.group_a.suppressed ? "withheld" : `${k.group_a.pct}% (${k.group_a.n})`}; B {k.group_b.suppressed ? "withheld" : `${k.group_b.pct}% (${k.group_b.n})`}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * The selection-bias panel for one programme (WP3): who is in the figures against who is not, and the intent-to-treat view beside the completers.
 * Admin view, so it also shows the comparison with members who joined but did not agree (never in a sponsor pack). Descriptive only.
 */
export async function SelectionPanelSection({ supabase, cohortId, from, to }: { supabase: SupabaseClient; cohortId: string; from?: string; to?: string }) {
  const { data, error } = await supabase.rpc("selection_panel_report", { p_cohort: cohortId, p_from: from, p_to: to });
  const panel = error ? null : parseSelectionPanel(data);
  return (
    <section aria-labelledby="sp-selection" className="space-y-3">
      <h2 id="sp-selection" className="font-medium">Who is in these figures, and who is not</h2>
      {!panel ? (
        <p role="alert">The panel could not be read. Please refresh.</p>
      ) : panelAwaitingSignature(panel) ? (
        <p>Awaiting the Chief Medical Officer&apos;s signature of the cascade and panel definitions. Nothing is shown until then.</p>
      ) : (
        <>
          <p className="text-sm">{panel.note}</p>
          <p className="text-sm">{panel.eligible_roster.reason}</p>
          {panel.seats.suppressed ? <p>Seats: {stageWithheldText(panel.seats.reason, panel.seats.minimum)}</p> : <p>Seats offered {panel.seats.seats_offered}, members joined {panel.seats.members_joined} ({panel.seats.take_up_pct_of_seats ?? "not given"}%). {panel.seats.note}</p>}
          <Compare title="In the figures compared with other adult Members" c={panel.comparisons.in_figures_vs_other_members} />
          <Compare title="In the figures compared with members who joined but did not agree (internal only)" c={panel.comparisons.in_figures_vs_joined_not_agreed} />
          {Object.entries(panel.intent_to_treat_and_completers).map(([key, d]) => (
            <div key={key} className="space-y-1">
              <p className="font-medium">Day {d.day}: everyone who joined, beside people with enough readings</p>
              {d.suppressed ? (
                <p>{stageWithheldText(d.reason, d.minimum)}</p>
              ) : !isIttShown(d.intent_to_treat) ? (
                <p>Withheld: a group is too small to show.</p>
              ) : (
                <>
                  <p>
                    Everyone whose day is due ({d.intent_to_treat.n}): <strong>{d.intent_to_treat.rate_strict_pct}%</strong> under control, counting people with no usable reading as not controlled
                    ({d.intent_to_treat.insufficient_data} people, {d.intent_to_treat.missing_pct}%).
                  </p>
                  <p>Only people with enough readings: {d.completers_only.rate_pct ?? "not shown (too few)"}{d.completers_only.rate_pct == null ? "" : "%"}. {d.completers_only.note}</p>
                  <ul className="list-disc pl-5">
                    {d.missing_split.map((m) => (
                      <li key={m.key}>{MISSING_LABELS[m.key] ?? m.key}: {m.suppressed ? "withheld" : m.n}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
