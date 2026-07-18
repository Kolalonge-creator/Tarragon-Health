"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { generateOutcomeReport } from "./actions";
import { useOutcomeReports, useTogglePublished, reportsKey, type OutcomeReport } from "@/lib/queries/outcome-reports";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

/**
 * Published, shareable outcome reports (docs/FULL_SPECIFICATION_V4.md
 * §2.4/§8 — "quarterly 'state of workforce health,' anonymised... used in BD
 * conversations the way peer-reviewed studies are used by Omada"). Snapshots
 * the same anonymised cohort analytics already shown live above, for a
 * chosen period, so it can be quoted externally without the underlying
 * numbers drifting. Publishing is a one-click toggle, not a webpage yet —
 * "shareable" here means "safe to paste into a BD deck," not a public URL.
 */
export function OutcomeReportsPanel({ organisationId }: { organisationId: string }) {
  const reports = useOutcomeReports(organisationId);
  const togglePublished = useTogglePublished(organisationId);
  const [state, formAction, pending] = useActionState(generateOutcomeReport, undefined);
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [periodStart, setPeriodStart] = useState(quarterAgo(today));
  const [periodEnd, setPeriodEnd] = useState(today);

  // generateOutcomeReport is a server action (useActionState), not a React
  // Query mutation, so nothing invalidated useOutcomeReports' cache after a
  // successful generate -- the "Report generated." message showed while the
  // list below still said "No reports generated yet." until a full page
  // reload. Found live-generating a report against this exact page.
  const lastMessageRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (state?.message && state.message !== lastMessageRef.current) {
      lastMessageRef.current = state.message;
      queryClient.invalidateQueries({ queryKey: reportsKey(organisationId) });
    }
  }, [state?.message, organisationId, queryClient]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Outcome reports
        </CardTitle>
        <CardDescription>
          A point-in-time, anonymised snapshot of your workforce&apos;s numbers for a period you choose —
          safe to share externally, since it won&apos;t change after it&apos;s generated.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form action={formAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="organisation_id" value={organisationId} />
          <div className="space-y-1.5">
            <Label htmlFor="report_period_start">From</Label>
            <Input
              id="report_period_start"
              name="period_start"
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report_period_end">To</Label>
            <Input
              id="report_period_end"
              name="period_end"
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              required
            />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Generating…" : "Generate report"}
          </Button>
        </form>
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state?.message && <p className="text-sm text-deep-forest">{state.message}</p>}

        {reports.isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {reports.data && reports.data.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No reports generated yet.</p>
        )}
        {reports.data && reports.data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {reports.data.map((report) => (
              <ReportRow
                key={report.id}
                report={report}
                onTogglePublished={(published) => togglePublished.mutate({ id: report.id, published })}
                togglePending={togglePublished.isPending}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function quarterAgo(isoDate: string): string {
  const d = new Date(isoDate);
  d.setMonth(d.getMonth() - 3);
  return d.toISOString().slice(0, 10);
}

function ReportRow({
  report,
  onTogglePublished,
  togglePending,
}: {
  report: OutcomeReport;
  onTogglePublished: (published: boolean) => void;
  togglePending: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const snapshot = report.snapshot as {
    analytics?: { cohort_size?: number };
  } | null;

  return (
    <li className="space-y-2 py-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-charcoal-ink">
            {report.period_start} — {report.period_end}
          </p>
          <p className="text-xs text-charcoal-ink/60">
            {snapshot?.analytics?.cohort_size != null
              ? `${snapshot.analytics.cohort_size} people covered`
              : "Generated"}{" "}
            · {new Date(report.generated_at).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={report.published ? "green" : "grey"}>
            {report.published ? "Published" : "Draft"}
          </Badge>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={togglePending}
            onClick={() => onTogglePublished(!report.published)}
          >
            {report.published ? "Unpublish" : "Publish"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Hide" : "View"}
          </Button>
        </div>
      </div>
      {expanded && (
        <pre className="max-h-64 overflow-auto rounded-md bg-charcoal-ink/5 p-3 text-xs text-charcoal-ink/80">
          {JSON.stringify(report.snapshot, null, 2)}
        </pre>
      )}
    </li>
  );
}
