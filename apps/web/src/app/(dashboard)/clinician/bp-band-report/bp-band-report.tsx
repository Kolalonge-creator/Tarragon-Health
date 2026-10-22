import { createClient } from "@/lib/supabase/server";

const CAUSE_LABEL: Record<string, string> = {
  none: "Same level",
  personal_target: "Raised because the patient's own target is lower than the standard line",
  pregnancy: "Raised because she is pregnant (pregnancy lines are lower)",
  rule_set_no_symptom: "Lowered from emergency to red: no red-flag symptom near it, and the approved rule set says so",
};

const LEVEL_LABEL: Record<string, string> = { green: "Green", amber: "Amber", red: "Red", emergency: "Emergency" };

/**
 * OQ-67 evidence, read only (S07y). For the last 30 days: how many blood pressure readings the app band (what the badge on the phone and web shows)
 * and the level the live alert trigger acts on place differently, and why. It changes no threshold. The Chief Medical Officer decides from this.
 */
export async function BpBandReport() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bp_band_divergence_report", { p_days: 30 });
  if (error || !data) return <p role="alert" className="text-sm text-red-700">The report could not be loaded. Please refresh.</p>;
  const total = data.reduce((n, r) => n + Number(r.readings), 0);
  const differ = data.filter((r) => r.cause !== "none").reduce((n, r) => n + Number(r.readings), 0);
  const approved = data[0]?.rule_set_approved ?? null;
  return (
    <div className="space-y-4 text-sm">
      <p>
        <strong>{total}</strong> blood pressure readings from real (not test) accounts in the last 30 days. <strong>{differ}</strong> are placed at a different level by the alert trigger than by the app band.
      </p>
      {total === 0 ? <p>No real patient has logged a reading in the last 30 days, so there is nothing to compare yet. The report fills in as patients log.</p> : null}
      {approved !== null ? (
        <p>The approved triage rule set (the 200/130 and symptom decision) is {approved ? "approved, so the trigger applies it" : "not approved, so the trigger does not apply it yet"}.</p>
      ) : null}
      {data.length > 0 ? (
        <table className="w-full">
          <thead>
            <tr className="text-left">
              <th className="py-1 pr-3">App band</th>
              <th className="py-1 pr-3">Alert trigger acts on</th>
              <th className="py-1 pr-3">Reason</th>
              <th className="py-1 text-right">Readings</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={`${r.app_band}|${r.pipeline_level}|${r.cause}`} className="border-t">
                <td className="py-1 pr-3">{LEVEL_LABEL[r.app_band] ?? r.app_band}</td>
                <td className="py-1 pr-3">{LEVEL_LABEL[r.pipeline_level] ?? r.pipeline_level}</td>
                <td className="py-1 pr-3">{CAUSE_LABEL[r.cause] ?? r.cause}</td>
                <td className="py-1 text-right">{Number(r.readings)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <p className="text-charcoal-ink/70">
        Limits: the level is worked out again from each stored reading with the current profile and target of the patient, not the ones on the day. It does not model plan gating (a Free member gets a self-care message, not an alert), alert merging, or wearable estimates. It carries no patient identity.
        The decision this informs is OQ-67 in docs/OPEN-QUESTIONS.md. No band has been changed.
      </p>
    </div>
  );
}
