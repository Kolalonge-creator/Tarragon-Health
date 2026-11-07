import Link from "next/link";
import type { OpenHandover } from "@/lib/worklist/load-open-handovers";

export type { OpenHandover };

function timeText(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function patientLabel(h: OpenHandover): string {
  return [h.patient_name ?? "Unnamed patient", h.patient_number].filter(Boolean).join(" · ");
}

/** G10: cases another doctor wants to hand to the viewer. Shown on every doctor's home while any are waiting. */
export function HandoversOfferedSection({ handovers, now }: { handovers: OpenHandover[] | null; now: Date }) {
  if (handovers === null) {
    // Unknown is not zero: a failed read must not look like "nobody is handing you anything".
    return (
      <p className="rounded-2xl bg-white p-4 text-sm text-red-600" role="alert">
        Could not check for cases offered to you. Reload the page.
      </p>
    );
  }
  if (handovers.length === 0) return null;
  return (
    <section aria-labelledby="handovers-offered-heading" className="space-y-2">
      <h2 id="handovers-offered-heading" className="font-heading text-lg font-semibold text-charcoal-ink">
        Cases offered to you
      </h2>
      <ul className="space-y-2">
        {handovers.map((h) => (
          <li key={h.id} className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-charcoal-ink">
            <Link href={`/clinician/escalations/${h.escalation_id}`} className="font-medium text-brand-green underline">
              {patientLabel(h)}
            </Link>
            {h.is_critical && <span className="ml-2 font-medium text-red-700">Emergency-level case</span>}
            <p className="text-charcoal-ink/70">
              From {h.from_name ?? "another doctor"} · answer by {timeText(h.acknowledge_by)}
              {new Date(h.acknowledge_by) <= now && <span className="ml-1 font-medium text-red-700">(overdue)</span>}
            </p>
            <p>Still to do: {h.outstanding_action}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** DW-18: handovers nobody answered in time, on the CMO's oversight view. No page is sent; this list is the signal. */
export function OverdueHandoversBlock({ handovers }: { handovers: OpenHandover[] | null }) {
  return (
    <div className="rounded-2xl bg-white p-4 text-sm">
      <h3 className="mb-2 font-medium text-charcoal-ink">Handovers not answered in time</h3>
      {handovers === null ? (
        <p className="text-red-600">Could not load handovers. Reload the page. This is not an all-clear.</p>
      ) : handovers.length === 0 ? (
        <p className="text-charcoal-ink/60">None waiting past their time.</p>
      ) : (
        <ul className="space-y-2">
          {handovers.map((h) => (
            <li key={h.id}>
              <Link href={`/clinician/escalations/${h.escalation_id}`} className="font-medium text-brand-green underline">
                {patientLabel(h)}
              </Link>
              {h.is_critical && <span className="ml-2 font-medium text-red-700">Emergency-level</span>}
              <p className="text-charcoal-ink/70">
                {h.from_name ?? "A doctor"} to {h.to_name ?? "a doctor"} · was due {timeText(h.acknowledge_by)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
