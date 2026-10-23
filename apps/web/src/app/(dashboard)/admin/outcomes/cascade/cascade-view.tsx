import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  controlLabel,
  isAwaitingSignature,
  isStageShown,
  stageWithheldText,
  type CascadeBlock,
  type CascadeReport,
} from "@/lib/outcomes/cascade-report";

function Block({ block, minimum }: { block: CascadeBlock; minimum: number }) {
  if (block.suppressed) return <p>{stageWithheldText(block.reason, block.minimum)}</p>;
  return (
    <div className="space-y-3">
      <ol className="space-y-2">
        {block.stages.map((s) => (
          <li key={s.code}>
            <p className="font-medium">{s.label}</p>
            {isStageShown(s) ? (
              <p>
                <strong>{s.n}</strong> people
                {s.step_of === null ? "" : `, ${s.pct_of_step ?? "not given"}% of the ${s.step_of.replace("_", " ")} step`}
                {s.pct_of_enrolled !== null ? ` (${s.pct_of_enrolled}% of enrolled)` : ""}.
              </p>
            ) : (
              <p>{stageWithheldText(s.reason, minimum)}</p>
            )}
            <p className="text-sm">{s.definition}</p>
          </li>
        ))}
      </ol>
      {block.control_among_treated.length > 0 ? (
        <div>
          <p className="font-medium">Control among people on a recorded medicine</p>
          <ul className="list-disc pl-5">
            {block.control_among_treated.map((c) => (
              <li key={c.key}>{controlLabel(c.key)}: {c.suppressed ? stageWithheldText(c.reason, c.minimum) : `${c.n} (${c.pct_of_treated ?? "not given"}%)`}</li>
            ))}
          </ul>
          <p className="text-sm">People whose control cannot be read are shown as unknown. They are not counted as controlled or as not controlled, and they are not left out.</p>
        </div>
      ) : null}
    </div>
  );
}

export function CascadeView({ title, report }: { title: string; report: CascadeReport | null }) {
  return (
    <section aria-labelledby={`cascade-${title}`} className="space-y-3">
      <h2 id={`cascade-${title}`} className="text-lg font-medium">{title}</h2>
      {!report ? (
        <p role="alert">This cascade could not be read. Please refresh, or ask an admin or the CMO to open it.</p>
      ) : isAwaitingSignature(report) ? (
        <p>Awaiting the Chief Medical Officer&apos;s signature.</p>
      ) : (
        <>
          <Card>
            <CardHeader><CardTitle>All months together</CardTitle></CardHeader>
            <CardContent><Block block={report.total} minimum={report.minimum_cell} /></CardContent>
          </Card>
          {report.by_month_of_joining.length > 0 ? (
            <Card>
              <CardHeader><CardTitle>By month of joining</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {report.by_month_of_joining.map((m) => (
                  <div key={m.month}>
                    <p className="font-medium">{m.month.slice(0, 7)}</p>
                    {"cascade" in m ? <Block block={m.cascade} minimum={report.minimum_cell} /> : <p>{stageWithheldText(m.reason, m.minimum)}</p>}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
          <section aria-label={`${title}: what this is and is not`} className="space-y-2 text-sm">
            <p className="font-medium">What this is not</p>
            <ul className="list-disc pl-5">
              {report.not_available.map((n) => (
                <li key={n.item}><strong>{n.item}: not available.</strong> {n.reason}</li>
              ))}
            </ul>
            <p>{report.note}</p>
            <p>{report.difference_from_bp_outcome_reports}</p>
            <p>It makes no claim about cause, is not a ranking of anyone, and is never a reason to withhold care. Definitions version {report.config_version}; smallest group shown {report.minimum_cell}.</p>
          </section>
        </>
      )}
    </section>
  );
}
