import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { APPLICATION_STATE_LABEL, formatDate } from "@/lib/credentialing/labels";
import type { QueueRow } from "@/lib/credentialing/schemas";
import { Muted, StateBadge } from "./shared";

const FLAG_LABEL: Record<string, string> = {
  in_use: "Folio held by another clinician",
  previously_rejected: "Folio on a rejected application",
  previously_suspended: "Folio on a suspended clinician",
};

/** What the person looking at the queue needs to do next, in plain words. */
const NEXT_STEP: Record<string, string> = {
  documents_submitted: "Start checks",
  checks_in_progress: "Record checks",
  training: "Waiting on training and test",
  test_passed: "Chief medical officer to approve",
  approved_tier1: "Switch on",
};

const OPEN_STATES = ["started", "documents_submitted", "checks_in_progress", "training", "test_passed", "approved_tier1"];

export function QueueTable({ rows, basePath }: { rows: QueueRow[]; basePath: string }) {
  const open = rows.filter((r) => OPEN_STATES.includes(r.state));
  const closed = rows.filter((r) => !OPEN_STATES.includes(r.state));
  const counts = OPEN_STATES.map((s) => ({ state: s, n: open.filter((r) => r.state === s).length })).filter((c) => c.n > 0);

  const table = (list: QueueRow[]) => (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-charcoal-ink/50 dark:text-night-ink/50">
          <tr>
            <th className="py-2 pr-3">Applicant</th>
            <th className="py-2 pr-3">State</th>
            <th className="py-2 pr-3">Next</th>
            <th className="py-2 pr-3">Checks</th>
            <th className="py-2 pr-3">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
          {list.map((r) => (
            <tr key={r.id}>
              <td className="py-2 pr-3">
                <Link href={`${basePath}/${r.id}`} className="font-medium text-brand-green underline-offset-2 hover:underline">
                  {r.applicant_name ?? "Unnamed applicant"}
                </Link>
                <div className="text-xs text-charcoal-ink/55">
                  {r.employment_type === "employed" ? "Employed" : "Freelance"}
                  {r.mdcn_folio ? ` · ${r.mdcn_folio}` : ""}
                </div>
                {r.folio_flag ? <Badge variant="red">{FLAG_LABEL[r.folio_flag] ?? r.folio_flag}</Badge> : null}
              </td>
              <td className="py-2 pr-3">
                <StateBadge state={r.state} />
              </td>
              <td className="py-2 pr-3">{NEXT_STEP[r.state] ?? ""}</td>
              <td className="py-2 pr-3">{r.checks_total > 0 ? `${r.checks_passed} of ${r.checks_total}` : "Not started"}</td>
              <td className="py-2 pr-3">{formatDate(r.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 text-sm">
        {counts.length === 0 ? <Muted>No open applications.</Muted> : null}
        {counts.map((c) => (
          <Badge key={c.state} variant="blue">
            {APPLICATION_STATE_LABEL[c.state]}: {c.n}
          </Badge>
        ))}
      </div>
      {open.length > 0 ? table(open) : null}
      {closed.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-sm font-medium">Decided and closed ({closed.length})</summary>
          <div className="mt-3">{table(closed)}</div>
        </details>
      ) : null}
    </div>
  );
}
