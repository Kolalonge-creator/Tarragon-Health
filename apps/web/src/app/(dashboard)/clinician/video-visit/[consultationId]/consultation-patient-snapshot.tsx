import type { ConsultationPrepBundle } from "@/lib/queries/consultation-video";
import { Badge } from "@/components/ui/badge";

/**
 * 68.9 clinical consultation screen — everything a clinician needs about
 * this patient (conditions, medications, allergies, recent results,
 * monitoring, previous consultations, referral reason) in one place,
 * without navigating multiple disconnected screens. Pure presentation over
 * consultation_prep_bundle()'s read model.
 */
export function ConsultationPatientSnapshot({ bundle }: { bundle: ConsultationPrepBundle }) {
  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="font-medium text-charcoal-ink">Reason for this visit</p>
        <p className="text-charcoal-ink/70">
          {bundle.reason.patient_prep_notes || bundle.reason.request_note || "Not provided."}
        </p>
      </div>

      <div>
        <p className="font-medium text-charcoal-ink">Conditions</p>
        {bundle.active_conditions.length === 0 ? (
          <p className="text-charcoal-ink/50">None on record.</p>
        ) : (
          <ul className="space-y-1">
            {bundle.active_conditions.map((c, i) => (
              <li key={i} className="flex flex-wrap items-center gap-1.5">
                <span className="text-charcoal-ink/80">{c.condition_name}</span>
                <Badge variant="grey">{c.status.replace(/_/g, " ")}</Badge>
                {c.severity && <Badge variant="amber">{c.severity}</Badge>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="font-medium text-charcoal-ink">Allergies</p>
        {bundle.allergies.length === 0 ? (
          <p className="text-charcoal-ink/50">None on record.</p>
        ) : (
          <ul className="space-y-1">
            {bundle.allergies.map((a, i) => (
              <li key={i} className="text-charcoal-ink/80">
                {a.allergen}
                {a.reaction ? ` — ${a.reaction}` : ""}
                {a.severity ? ` (${a.severity})` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="font-medium text-charcoal-ink">Active medications</p>
        {bundle.active_medications.length === 0 ? (
          <p className="text-charcoal-ink/50">None on record.</p>
        ) : (
          <ul className="space-y-1">
            {bundle.active_medications.map((m, i) => (
              <li key={i} className="text-charcoal-ink/80">
                {m.drug_name}
                {m.dose ? ` ${m.dose}` : ""}
                {m.frequency ? ` — ${m.frequency}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="font-medium text-charcoal-ink">Recent results</p>
        {bundle.recent_results.length === 0 ? (
          <p className="text-charcoal-ink/50">None on record.</p>
        ) : (
          <ul className="space-y-1">
            {bundle.recent_results.map((r, i) => (
              <li key={i} className="text-charcoal-ink/80">
                {new Date(r.created_at).toLocaleDateString()} — {r.result_status}
                {r.result_summary ? `: ${r.result_summary}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="font-medium text-charcoal-ink">Monitoring — recent vitals</p>
        {bundle.recent_vitals.length === 0 ? (
          <p className="text-charcoal-ink/50">No recent readings.</p>
        ) : (
          <p className="text-charcoal-ink/60">{bundle.recent_vitals.length} recent reading(s) — see the full chart for detail.</p>
        )}
      </div>

      {bundle.care_gaps.length > 0 && (
        <div>
          <p className="font-medium text-charcoal-ink">Open care gaps</p>
          <ul className="space-y-1">
            {bundle.care_gaps.map((g, i) => (
              <li key={i} className="text-amber-700">
                {g.gap_type.replace(/_/g, " ")}
                {g.condition_or_type ? ` — ${g.condition_or_type}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="font-medium text-charcoal-ink">Previous consultations</p>
        {bundle.previous_consultations.length === 0 ? (
          <p className="text-charcoal-ink/50">None on record.</p>
        ) : (
          <ul className="space-y-1">
            {bundle.previous_consultations.map((p, i) => (
              <li key={i} className="text-charcoal-ink/80">
                {new Date(p.encounter_date).toLocaleDateString()} — {p.encounter_type.replace(/_/g, " ")}
                {p.diagnosis ? `: ${p.diagnosis}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
