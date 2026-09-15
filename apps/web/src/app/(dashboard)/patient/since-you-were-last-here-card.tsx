import { createClient } from "@/lib/supabase/server";
import { SEMANTIC_ICON } from "@/lib/icons";

type SinceLastVisitSummary = {
  show: boolean;
  days_since: number;
  messages_count: number;
  points_earned: number;
  highlights: Array<{ event_type: string; title: string }>;
};

const HIGHLIGHT_LABEL: Record<string, string> = {
  lab_completed: "A lab result came back",
  screening_completed: "A screening was completed",
  vaccination_recorded: "A vaccination was recorded",
  care_plan_updated: "Your care plan was updated",
  escalation_resolved: "An open concern was resolved",
  discharge_recorded: "A discharge was recorded",
  referral_status_changed: "Your referral status changed",
};

/**
 * "Since you were last here" — a session-delta highlight reel, not a second
 * copy of PatientTimeline's unbounded chronological log. Pure synthesis over
 * data the patient already owns under RLS via public.get_since_last_visit_
 * summary(), which self-hides (returns show:false) for a first-ever visit,
 * a same-day reopen, or a gap with nothing worth mentioning.
 */
async function resolveSinceLastVisit(patientId: string): Promise<SinceLastVisitSummary | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_since_last_visit_summary", { p_patient_id: patientId });
  const summary = data as SinceLastVisitSummary | null;
  return summary?.show ? summary : null;
}

export async function SinceYouWereLastHere({
  patientId,
  acting,
}: {
  patientId: string;
  acting: boolean;
}) {
  // Session recency belongs to whoever is browsing, not the patient record
  // on screen — skip entirely for a caregiver acting on a dependent's behalf.
  if (acting) return null;

  const summary = await resolveSinceLastVisit(patientId);
  if (!summary) return null;

  const bits: string[] = [];
  if (summary.messages_count > 0) {
    bits.push(
      `${summary.messages_count} message${summary.messages_count === 1 ? "" : "s"} from your care team`,
    );
  }
  if (summary.points_earned > 0) {
    bits.push(`${summary.points_earned} wellness points earned`);
  }
  for (const h of summary.highlights) {
    bits.push(HIGHLIGHT_LABEL[h.event_type] ?? h.title);
  }

  return (
    <div className="flex items-start gap-3 rounded-xl border border-brand-green/20 bg-brand-green/5 p-4 dark:border-brand-green-bright/30 dark:bg-brand-green-bright/10">
      <SEMANTIC_ICON.preventive
        className="mt-0.5 h-5 w-5 shrink-0 text-deep-forest dark:text-brand-green-bright"
        aria-hidden
      />
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
          It&apos;s been {summary.days_since} day{summary.days_since === 1 ? "" : "s"}. While you
          were away:
        </p>
        <ul className="space-y-0.5 text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          {bits.slice(0, 4).map((bit, i) => (
            <li key={i}>{bit}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
