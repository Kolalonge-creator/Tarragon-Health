import type { TabletopRuns } from "@/lib/community/model";
import { DRILL_STEPS } from "./drill-steps";
import { formatWhen } from "./staff-format";

/** The steps, as a plain numbered list (for people who may read the drill but not record it). */
export function DrillSteps() {
  return (
    <ol className="list-decimal space-y-1 pl-5 text-sm text-charcoal-ink">
      {DRILL_STEPS.map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ol>
  );
}

/** Past runs, newest first. Says in words whether each one passed. */
export function DrillRuns({ runs }: { runs: TabletopRuns["runs"] }) {
  if (runs.length === 0) return <p className="text-sm text-charcoal-ink">No drill has been recorded yet. The community should not go live before one has passed.</p>;
  return (
    <ul className="space-y-3">
      {runs.map((r) => {
        const failed = r.steps.filter((s) => !s.ok);
        return (
          <li key={r.id} className="space-y-1 rounded-lg border border-charcoal-ink/15 bg-white p-3 text-sm text-charcoal-ink">
            <p>
              <strong>{r.passed ? "Passed" : "Did not pass"}</strong>{" "}
              <time dateTime={r.run_at}>{formatWhen(r.run_at)}</time>
              {r.run_by_name ? `, recorded by ${r.run_by_name}` : ""}
            </p>
            {r.steps.length > 0 && (
              <p>
                {r.steps.length - failed.length} of {r.steps.length} steps ticked.
                {failed.length > 0 ? ` Not ticked: ${failed.map((s) => s.step).join(" ")}` : ""}
              </p>
            )}
            {r.notes && <p className="whitespace-pre-wrap break-words">Notes: {r.notes}</p>}
          </li>
        );
      })}
    </ul>
  );
}
